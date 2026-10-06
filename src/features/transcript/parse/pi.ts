import type { HarnessKind } from "@/daemon/types/ws";
import type { ParseContext, TranscriptNode } from "./types";
import { contentImages } from "./images";
import { nativeToolActions } from "./nativeTools";
import { asArray, asRecord, outputText, rawNode, stringAt, toolTargetFromInput } from "./shared";

export interface PiStreamState {
  message?: Record<string, unknown>;
}

// Current RPC updates contain deltas only. Retain one assistant message per
// session so block keys match its authoritative completion and stored JSONL.
function streamingUpdate(
  record: Record<string, unknown>,
  state: PiStreamState,
  harness: HarnessKind,
): TranscriptNode[] {
  const event = asRecord(record.assistantMessageEvent);
  if (!event) return [];
  if (event.type === "done" || event.type === "error") {
    const message = asRecord(event.message ?? event.error);
    return message ? parseMessage(message, harness) : [];
  }
  if (!state.message) return [];
  const index = event.contentIndex;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return [];
  const content = asArray(state.message.content) ?? [];
  state.message.content = content;
  const block = asRecord(content[index]);
  const type = String(event.type);
  if (type.startsWith("text_") || type.startsWith("thinking_")) {
    const field = type.startsWith("text_") ? "text" : "thinking";
    const text = type.endsWith("_end")
      ? (stringAt(event, "content") ?? "")
      : type.endsWith("_delta")
        ? (stringAt(block, field) ?? "") + (stringAt(event, "delta") ?? "")
        : (stringAt(block, field) ?? "");
    content[index] = { type: field, [field]: text };
    const key = piMessageKey(state.message);
    return [
      {
        kind: field === "text" ? "assistant" : "thinking",
        key: key ? `${key}:${index}` : undefined,
        text,
        streaming: !type.endsWith("_end"),
        delta: false,
      },
    ];
  }
  if (type === "toolcall_start")
    content[index] = { type: "toolCall", id: event.id, name: event.toolName, arguments: {} };
  else if (type === "toolcall_end") content[index] = event.toolCall;
  else return [];
  // The native call ID joins this preview to final arguments and tool results.
  const onlyBlock: unknown[] = [];
  onlyBlock[index] = content[index];
  return parseMessage({ ...state.message, content: onlyBlock }, harness, true);
}

// Timestamp and role remain stable between RPC and persisted messages.
export function piMessageKey(message: Record<string, unknown>): string | undefined {
  const timestamp = message.timestamp;
  return typeof timestamp === "number" || typeof timestamp === "string"
    ? `pi:${String(message.role)}:${timestamp}`
    : undefined;
}

function toolResult(message: Record<string, unknown>, streaming = false): TranscriptNode[] {
  const name = stringAt(message, "toolName") ?? "tool_result";
  const callId = stringAt(message, "toolCallId");
  const result = asRecord(message.result) ?? message;
  return [
    {
      kind: "tool",
      key: callId ? `pi:tool:${callId}` : undefined,
      tool: name,
      label: name,
      update: true,
      status: streaming ? "running" : result.isError ? "failed" : "done",
      native: { callId, metadata: result.details },
      details: { output: result },
      detailText: outputText(result.content),
    },
  ];
}

function parseMessage(
  message: Record<string, unknown>,
  harness: HarnessKind,
  streaming = false,
): TranscriptNode[] {
  const key = piMessageKey(message);
  const content = message.content;
  const blocks =
    typeof content === "string" ? [{ type: "text", text: content }] : (asArray(content) ?? []);
  if (message.role === "toolResult") return toolResult(message);
  if (message.role === "user") {
    return [
      {
        kind: "user",
        key,
        messageId: key,
        text: blocks
          .map((block) => stringAt(asRecord(block), "text") ?? "")
          .filter(Boolean)
          .join("\n"),
        images: contentImages(content),
      },
    ];
  }
  if (message.role === "bashExecution") {
    const command = stringAt(message, "command");
    return [
      {
        kind: "tool",
        key,
        tool: "bash",
        label: "bash",
        target: command,
        actions: [{ kind: "command", target: command }],
        status: message.cancelled ? "cancelled" : message.exitCode === 0 ? "done" : "failed",
        details: { input: { command }, output: message.output },
        detailText: outputText(message.output),
      },
    ];
  }
  if (message.role === "custom" && message.display === false) return [];
  if (message.role !== "assistant" && message.role !== "custom") return [rawNode(harness, message)];
  const nodes = blocks.flatMap((value, index): TranscriptNode[] => {
    const block = asRecord(value);
    if (!block) return [rawNode(harness, value)];
    const blockKey = key ? `${key}:${index}` : undefined;
    if (block.type === "text" || block.type === "thinking") {
      const text = stringAt(block, block.type) ?? "";
      return [
        {
          kind: block.type === "text" ? "assistant" : "thinking",
          key: blockKey,
          text,
          streaming,
          delta: false,
        },
      ];
    }
    if (block.type === "toolCall") {
      const name = stringAt(block, "name") ?? "tool";
      const callId = stringAt(block, "id");
      const input = asRecord(block.arguments);
      return [
        {
          kind: "tool",
          key: callId ? `pi:tool:${callId}` : blockKey,
          tool: name,
          label: name,
          status: "pending",
          target: toolTargetFromInput(input),
          actions: nativeToolActions(name, input, "pi"),
          actionSource: "native",
          native: { callId, messageId: key },
          details: { input },
        },
      ];
    }
    return [rawNode(harness, value)];
  });
  if (typeof message.errorMessage === "string" && message.errorMessage) {
    nodes.push({
      kind: "system",
      key: key ? `${key}:error` : undefined,
      level: message.stopReason === "aborted" ? "warning" : "error",
      text: message.errorMessage,
    });
  }
  return nodes;
}

export function parsePiEvent(
  raw: unknown,
  harness: HarnessKind = "pi",
  context?: ParseContext,
): TranscriptNode[] {
  const record = asRecord(raw);
  if (!record) return [rawNode(harness, raw)];
  const type = stringAt(record, "type");
  if (
    type === "message" ||
    type === "message_start" ||
    type === "message_update" ||
    type === "message_end"
  ) {
    const message = asRecord(record.message);
    const state = context?.piStream;
    if (message?.role === "assistant" && state) {
      state.message = { ...message, content: [...(asArray(message.content) ?? [])] };
    }
    if (type === "message_update" && !message && state)
      return streamingUpdate(record, state, harness);
    if (type === "message_end" && message?.role === "assistant" && state) state.message = undefined;
    return message
      ? parseMessage(message, harness, type === "message_start" || type === "message_update")
      : [];
  }
  if (type === "tool_execution_start") {
    const name = stringAt(record, "toolName") ?? "tool";
    const callId = stringAt(record, "toolCallId");
    const input = asRecord(record.args);
    return [
      {
        kind: "tool",
        key: callId ? `pi:tool:${callId}` : undefined,
        tool: name,
        label: name,
        status: "running",
        target: toolTargetFromInput(input),
        actions: nativeToolActions(name, input, "pi"),
        actionSource: "native",
        native: { callId },
        details: { input },
      },
    ];
  }
  if (type === "tool_execution_update")
    return toolResult({ ...record, result: record.partialResult }, true);
  if (type === "tool_execution_end")
    return toolResult({
      ...record,
      result: { ...asRecord(record.result), isError: record.isError },
    });
  if (type === "extension_ui_request") {
    if (record.method === "notify")
      return [
        {
          kind: "system",
          key: stringAt(record, "id"),
          level:
            record.notifyType === "warning" || record.notifyType === "error"
              ? record.notifyType
              : "info",
          text: stringAt(record, "message") ?? "",
        },
      ];
    if (
      [
        "select",
        "confirm",
        "input",
        "editor",
        "setStatus",
        "setWidget",
        "setTitle",
        "set_editor_text",
      ].includes(String(record.method))
    )
      return [];
  }
  if (type === "extension_error")
    return [
      { kind: "system", level: "error", text: stringAt(record, "error") ?? outputText(raw) ?? "" },
    ];
  if (
    [
      "session",
      "session_info",
      "model_change",
      "thinking_level_change",
      "label",
      "custom",
      "session_info_changed",
      "thinking_level_changed",
      "agent_start",
      "agent_end",
      "agent_settled",
      "turn_start",
      "turn_end",
    ].includes(type ?? "")
  )
    return [];
  if (type === "response" && record.success === true) return [];
  if (type === "response" && record.success === false)
    return [{ kind: "system", level: "error", text: stringAt(record, "error") ?? "" }];
  if (type === "custom_message") return parseMessage({ ...record, role: "custom" }, harness);
  return [rawNode(harness, raw)];
}

export function parsePiHistoryLine(line: string, harness: HarnessKind = "pi"): TranscriptNode[] {
  try {
    return parsePiEvent(JSON.parse(line), harness);
  } catch {
    return [rawNode(harness, line)];
  }
}
