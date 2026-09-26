import { claudeCommandText } from "./claudeCommandText";
import { nativeToolActions } from "./nativeTools";
import { contentImages } from "./images";
import type { HarnessKind } from "@/daemon/types/ws";
import type { ParseContext, TranscriptNode } from "./types";
import { parseClaudeStreamEvent } from "./claudeStream";
import {
  asArray,
  asRecord,
  booleanAt,
  numberAt,
  outputText,
  parseUnifiedDiff,
  parseFileContents,
  rawNode,
  stringAt,
  toolTargetFromInput,
} from "./shared";

function toolNodeFromToolUse(block: Record<string, unknown>): TranscriptNode {
  const name = stringAt(block, "name") ?? "tool";
  const input = asRecord(block["input"]);
  return {
    kind: "tool",
    tool: name,
    label: name,
    title: stringAt(input, "description"),
    actions: nativeToolActions(name, input, "claude"),
    details: { input },
    target: toolTargetFromInput(input),
    detailText: outputText(input),
    status: "running",
    key: stringAt(block, "id"),
  };
}

function toolNodeFromToolResult(block: Record<string, unknown>): TranscriptNode {
  const failed = booleanAt(block, "is_error") === true;
  return {
    kind: "tool",
    tool: "tool_result",
    label: "Result",
    detailText: outputText(block["content"]),
    details: { output: block["content"] },
    status: failed ? "failed" : "done",
    key: stringAt(block, "tool_use_id"),
  };
}

function parseContentBlocks(
  blocks: unknown[],
  role: "user" | "assistant",
  harness: HarnessKind,
  messageId?: string,
  fragmentId?: string,
): TranscriptNode[] {
  const nodes: TranscriptNode[] = [];
  for (const [index, block] of blocks.entries()) {
    const record = asRecord(block);
    if (record === undefined) {
      continue;
    }
    const type = stringAt(record, "type");
    const identity = role === "assistant" && messageId ? {
      claude: { messageId, ...(fragmentId ? { blockId: `${fragmentId}:${index}` } : { blockIndex: index }) },
    } : {};
    const blockKey = fragmentId ?? messageId;
    if (type === "text") {
      const text = stringAt(record, "text");
      if (text !== undefined && text.length > 0) {
        nodes.push({ ...(role === "user" ? claudeCommandText(text) : undefined) ?? { kind: role, text }, ...identity, ...(blockKey ? { key: `${blockKey}:${role}:${index}` } : {}) });
      }
      continue;
    }
    if (type === "image" && role === "user") {
      continue;
    }
    if (type === "thinking") {
      const text = stringAt(record, "thinking") ?? "";
      if (text.length > 0) {
        nodes.push({ kind: "thinking", text, ...identity, ...(blockKey ? { key: `${blockKey}:thinking:${index}` } : {}) });
      }
      continue;
    }
    if (type === "tool_use") {
      nodes.push(toolNodeFromToolUse(record));
      continue;
    }
    if (type === "tool_result") {
      nodes.push(toolNodeFromToolResult(record));
      continue;
    }
    if (type === "tool_verification" || type === "redacted_thinking") {
      continue;
    }
    nodes.push(rawNode(harness, block));
  }
  if (role === "user") {
    const images = contentImages(blocks);
    if (images.length) {
      const user = nodes.find((node) => node.kind === "user");
      if (user?.kind === "user") user.images = images;
      else nodes.push({ kind: "user", text: "", images, ...(messageId ? { key: `${messageId}:images` } : {}) });
    }
  }
  return nodes;
}

function parseMessageLike(
  raw: Record<string, unknown>,
  role: "user" | "assistant",
  harness: HarnessKind,
): TranscriptNode[] {
  const message = asRecord(raw["message"]);
  // Claude marks injected resume instructions and their synthetic acknowledgement.
  // Literal user/assistant text is never used to decide whether to hide a message.
  if (
    raw["isMeta"] === true || raw["isSynthetic"] === true || raw["turnCompanion"] === true ||
    message?.["model"] === "<synthetic>"
  ) return [];
  const content = message?.["content"] ?? raw["content"];
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : asArray(content);
  if (blocks === undefined) return [];
  const messageId = role === "assistant"
    ? stringAt(message, "id") ?? stringAt(raw, "uuid")
    : stringAt(raw, "uuid") ?? stringAt(message, "id");
  const nodes = parseContentBlocks(blocks, role, harness, messageId, role === "assistant" ? stringAt(raw, "uuid") : undefined);
  for (const node of nodes) {
    if (node.kind === "tool") node.native = { callId: node.key, messageId,
      parentCallId: stringAt(raw, "parent_tool_use_id"), sessionId: stringAt(raw, "session_id") };
  }
  const result = asRecord(raw["tool_use_result"] ?? raw["toolUseResult"]);
  const path = stringAt(result, "filePath");
  const failed = blocks.some((block) => asRecord(block)?.["is_error"] === true);
  if (role === "user" && path && !failed) {
    const hunks = asArray(result?.["structuredPatch"]);
    const patch = hunks?.map((hunk) => {
      const h = asRecord(hunk);
      return `@@ -${numberAt(h, "oldStart") ?? 1},${numberAt(h, "oldLines") ?? 0} +${numberAt(h, "newStart") ?? 1},${numberAt(h, "newLines") ?? 0} @@\n${(asArray(h?.["lines"]) ?? []).join("\n")}`;
    }).join("\n");
    const content = stringAt(result, "content");
    const diff = patch ? parseUnifiedDiff(patch)
      : result?.["type"] === "create" && content !== undefined ? parseFileContents(content, "add") : undefined;
    if (diff) {
      const toolId = nodes.find((node) => node.kind === "tool")?.key ?? messageId ?? path;
      nodes.push({ kind: "diff", path, ...diff, callId: toolId,
        change: result?.["type"] === "create" ? "add" : "update", key: `${toolId}:diff` });
    }
  }
  return nodes;
}

function parseSystemEvent(raw: Record<string, unknown>): TranscriptNode[] {
  const subtype = stringAt(raw, "subtype");
  if (subtype === "compact_boundary") {
    return [{ kind: "system", level: "info", key: stringAt(raw, "uuid"),
      text: "Conversation context compacted", messageKey: "commands.compacted" }];
  }
  if (subtype === "task_started" || subtype === "task_progress" || subtype === "task_notification" || subtype === "task_updated") {
    const key = stringAt(raw, "tool_use_id");
    if (!key) return [];
    const state = stringAt(raw, "status");
    return [{ kind: "tool", key, tool: "Agent", label: "Agent", update: true,
      title: stringAt(raw, "description"),
      status: state === "completed" ? "done" : state === "failed" ? "failed" : state === "stopped" || state === "killed" ? "cancelled" : "running",
      native: { callId: key, parentCallId: stringAt(raw, "parent_tool_use_id"), metadata: raw },
      details: { output: raw["summary"] ?? raw["output"] } }];
  }
  if (subtype === "api_retry") {
    const attempt = numberAt(raw, "attempt") ?? 0;
    const maxRetries = numberAt(raw, "max_retries") ?? 0;
    const status = numberAt(raw, "error_status");
    const error = stringAt(raw, "error") ?? "unknown";
    const statusText = status === undefined ? "unknown" : String(status);
    return [
      {
        kind: "system",
        level: "warning",
        text: `API retry ${attempt}/${maxRetries} (${statusText}): ${error}`,
        messageKey: "core.transcript.api_retry",
        values: { attempt, maxRetries },
      },
    ];
  }
  return [];
}

function parseResultEvent(raw: Record<string, unknown>): TranscriptNode[] {
  const isError = booleanAt(raw, "is_error") === true;
  if (!isError) {
    return [];
  }
  const turns = numberAt(raw, "num_turns");
  const apiMs = numberAt(raw, "duration_api_ms");
  const parts: string[] = ["Turn finished with an error"];
  if (turns !== undefined) {
    parts.push(`${turns} ${turns === 1 ? "turn" : "turns"}`);
  }
  if (apiMs !== undefined) {
    parts.push(`${(apiMs / 1000).toFixed(1)}s API time`);
  }
  return [
    {
      kind: "system",
      level: "error",
      text: parts.join(" — "),
      messageKey: "core.transcript.turn_failed",
    },
  ];
}

export function parseClaudeEvent(raw: unknown, harness: HarnessKind, context?: ParseContext): TranscriptNode[] {
  const record = asRecord(raw);
  if (record === undefined) {
    return [rawNode(harness, raw)];
  }
  if (record["type"] === "tool_progress") {
    const name = stringAt(record, "tool_name") ?? "tool";
    return [{ kind: "tool", tool: name, label: name, status: "running", update: true,
      key: stringAt(record, "tool_use_id"), durationMs: (numberAt(record, "elapsed_time_seconds") ?? 0) * 1000,
      native: { callId: stringAt(record, "tool_use_id"), parentCallId: stringAt(record, "parent_tool_use_id"), metadata: record } }];
  }
  if (record["type"] === "tool_use_summary") {
    const callIds = asArray(record["preceding_tool_use_ids"])?.filter((id): id is string => typeof id === "string") ?? [];
    return [{ kind: "activity_summary", text: stringAt(record, "summary") ?? "", callIds,
      parentCallId: stringAt(record, "parent_tool_use_id"), key: stringAt(record, "uuid") }];
  }
  switch (stringAt(record, "type")) {
    case "conversation_reset":
      return typeof record["new_conversation_id"] === "string" ? [{
        kind: "system", level: "info", key: `conversation-reset:${record["new_conversation_id"]}`,
        text: "Claude started a new conversation. Earlier messages remain visible above.",
        messageKey: "commands.conversation_reset",
      }] : [];
    case "stream_event":
      return parseClaudeStreamEvent(record, context?.claudeStream);
    case "assistant":
      return parseMessageLike(record, "assistant", harness);
    case "user":
      return parseMessageLike(record, "user", harness);
    case "system":
      return parseSystemEvent(record);
    case "result":
      return parseResultEvent(record);
    default:
      return [rawNode(harness, raw)];
  }
}

export function parseClaudeHistoryLine(line: string, harness: HarnessKind): TranscriptNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return [rawNode(harness, line)];
  }
  const record = asRecord(parsed);
  if (record === undefined) {
    return [rawNode(harness, parsed)];
  }
  switch (stringAt(record, "type")) {
    case "user":
      return parseMessageLike(record, "user", harness);
    case "assistant":
      return parseMessageLike(record, "assistant", harness);
    case "conversation_reset":
    case "tool_progress":
    case "tool_use_summary":
      return parseClaudeEvent(record, harness);
    case "attachment":
    case "queue-operation":
    case "system":
      return [];
    default:
      return [rawNode(harness, record)];
  }
}
