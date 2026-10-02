import { nativeToolActions } from "./nativeTools";
import type { TranscriptNode } from "./types";
import { asRecord, numberAt, outputText, stringAt, toolTargetFromInput } from "./shared";

type StreamBlock = { node: TranscriptNode; input: string };
type StreamMessage = { id: string; blocks: Map<number, StreamBlock> };
export type ClaudeStreamState = Map<string, StreamMessage>;

export function createClaudeStreamState(): ClaudeStreamState {
  return new Map();
}

function finishMessage(message: StreamMessage | undefined): TranscriptNode[] {
  return [...(message?.blocks.values() ?? [])].flatMap(({ node }) =>
    (node.kind === "assistant" || node.kind === "thinking") && node.streaming
      ? [{ ...node, streaming: false, delta: false }]
      : [],
  );
}

export function parseClaudeStreamEvent(
  raw: Record<string, unknown>,
  state?: ClaudeStreamState,
): TranscriptNode[] {
  const event = asRecord(raw.event);
  if (!event || !state) return [];
  const streamKey = stringAt(raw, "parent_tool_use_id") ?? "";
  const type = stringAt(event, "type");
  if (type === "message_start") {
    const id = stringAt(asRecord(event.message), "id");
    if (!id || state.get(streamKey)?.id === id) return [];
    const finished = finishMessage(state.get(streamKey));
    state.set(streamKey, { id, blocks: new Map() });
    return finished;
  }
  const message = state.get(streamKey);
  if (!message) return [];
  if (type === "message_stop") {
    state.delete(streamKey);
    return finishMessage(message);
  }
  const index = numberAt(event, "index");
  if (index === undefined) return [];
  if (type === "content_block_start") {
    const block = asRecord(event.content_block);
    if (!block) return [];
    const kind = stringAt(block, "type");
    let node: TranscriptNode;
    if (kind === "text" || kind === "thinking") {
      const nodeKind = kind === "text" ? "assistant" : "thinking";
      node = { kind: nodeKind, text: stringAt(block, kind) ?? "", streaming: true,
        delta: false, claude: { messageId: message.id, blockIndex: index }, key: `${message.id}:${nodeKind}:${index}` };
    } else if (kind === "tool_use") {
      const input = asRecord(block.input);
      const name = stringAt(block, "name") ?? "tool";
      node = { kind: "tool", tool: name, label: name, status: "pending",
        actions: nativeToolActions(name, input, "claude"), title: stringAt(input, "description"), details: { input },
        native: { messageId: message.id, callId: stringAt(block, "id"), parentCallId: streamKey || undefined },
        key: stringAt(block, "id"), target: toolTargetFromInput(input), detailText: outputText(input) };
    } else {
      return [];
    }
    message.blocks.set(index, { node, input: "" });
    return [node];
  }
  const block = message.blocks.get(index);
  if (!block) return [];
  if (type === "content_block_stop") {
    if (block.node.kind === "assistant" || block.node.kind === "thinking") {
      block.node = { ...block.node, streaming: false, delta: false };
      return [block.node];
    }
    return [];
  }
  if (type !== "content_block_delta") return [];
  const delta = asRecord(event.delta);
  if (!delta) return [];
  if ((delta.type === "text_delta" && block.node.kind === "assistant") ||
      (delta.type === "thinking_delta" && block.node.kind === "thinking")) {
    const text = stringAt(delta, delta.type === "text_delta" ? "text" : "thinking");
    if (text === undefined) return [];
    block.node = { ...block.node, text: block.node.text + text, streaming: true, delta: false };
    return [block.node];
  }
  if (delta.type === "input_json_delta" && block.node.kind === "tool") {
    block.input += stringAt(delta, "partial_json") ?? "";
    try {
      const input = asRecord(JSON.parse(block.input));
      block.node = { ...block.node, target: toolTargetFromInput(input), detailText: outputText(input),
        actions: nativeToolActions(block.node.tool, input, "claude"), title: stringAt(input, "description"), details: { input } };
      return [block.node];
    } catch {
      return [];
    }
  }
  return [];
}
