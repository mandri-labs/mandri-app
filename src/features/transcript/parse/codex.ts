import { codexCommandFallback } from "./codexCommandFallback";
import { codexCommandActions, nativeToolActions } from "./nativeTools";
import { parseAsyncQuestions, asyncQuestionText } from "./codexQuestions";
import { contentImages } from "./images";
import type { HarnessKind } from "@/daemon/types/ws";
import type { TranscriptNode } from "./types";
import { codexOutputText } from "./codexOutput";
import {
  asArray,
  asRecord,
  numberAt,
  parseArguments,
  parseFileContents,
  parseUnifiedDiff,
  rawNode,
  stringAt,
  toolTargetFromInput,
} from "./shared";

const SKIPPED_METHODS: readonly string[] = [
  "remoteControl/status/changed",
  "mcpServer/startupStatus/updated",
  "thread/started",
  "thread/status/changed",
  "turn/started",
];

function isJsonRpcResult(record: Record<string, unknown>): boolean {
  return !("method" in record) && "id" in record && "result" in record;
}

function textFromContent(content: unknown): string | undefined {
  const blocks = asArray(content);
  if (blocks === undefined) {
    return undefined;
  }
  const texts: string[] = [];
  for (const block of blocks) {
    const record = asRecord(block);
    const text = stringAt(record, "text");
    if (text !== undefined) {
      texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join("") : undefined;
}

function reasoningText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => (typeof part === "string" ? part : stringAt(asRecord(part), "text")))
      .filter((part): part is string => part !== undefined && part.length > 0);
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }
  return stringAt(asRecord(value), "text");
}

function toolNodeForItem(
  item: Record<string, unknown>,
  status: "running" | "done" | "failed",
): TranscriptNode[] {
  const nativeActions = codexCommandActions(item["commandActions"] ?? item["parsed_cmd"]);
  return [
    {
      kind: "tool",
      tool: "bash",
      label: "Shell",
      actions: nativeActions ?? codexCommandFallback(item["command"]),
      actionSource: nativeActions ? "native" : "fallback",
      native: { callId: stringAt(item, "id"), turnId: stringAt(item, "turnId"), metadata: item },
      codex: {
        input: { command: item["command"] },
        output: item["aggregatedOutput"] ?? item["output"],
      },
      target: stringAt(item, "command"),
      detailText: codexOutputText(item["aggregatedOutput"] ?? item["output"]),
      status,
      durationMs: numberAt(item, "durationMs"),
      key: stringAt(item, "id"),
    },
  ];
}

function parseItem(
  item: unknown,
  phase: "started" | "completed",
  harness: HarnessKind,
  turnId?: string,
): TranscriptNode[] {
  const record = asRecord(item);
  if (record === undefined) {
    return [rawNode(harness, item)];
  }
  const itemType = stringAt(record, "type");
  const key = stringAt(record, "id");
  if (itemType === "contextCompaction") {
    return phase === "completed"
      ? [
          {
            kind: "system",
            level: "info",
            key,
            text: "Conversation context compacted",
            messageKey: "commands.compacted",
          },
        ]
      : [];
  }
  if (itemType === "dynamicToolCall" || itemType === "mcpToolCall") {
    const name = stringAt(record, "tool") ?? stringAt(record, "name") ?? "tool";
    return [
      {
        kind: "tool",
        tool: name,
        label: name,
        key,
        actions: [{ kind: "tool" }],
        native: { callId: key, turnId, metadata: record },
        target: toolTargetFromInput(parseArguments(record["arguments"])),
        status:
          phase === "started"
            ? "running"
            : record["success"] === false || record["error"] != null
              ? "failed"
              : "done",
        durationMs: numberAt(record, "durationMs"),
        codex: {
          input: parseArguments(record["arguments"]) ?? record["arguments"],
          output: record["result"] ?? record["contentItems"] ?? record["error"],
        },
      },
    ];
  }
  if (itemType === "webSearch") {
    const action = asRecord(record["action"]);
    const target =
      stringAt(action, "query") ?? stringAt(action, "url") ?? stringAt(action, "pattern");
    return [
      {
        kind: "tool",
        tool: "webSearch",
        label: "Web search",
        key,
        target,
        actions: [{ kind: "web", target }],
        status: phase === "started" ? "running" : "done",
        native: { callId: key, turnId, metadata: record },
        details: { input: action },
      },
    ];
  }
  if (itemType === "userMessage") {
    if (phase === "started") {
      return [];
    }
    const text = textFromContent(record["content"]);
    const images = contentImages(record["content"]);
    return !text && !images.length
      ? []
      : [
          {
            kind: "user",
            text: text ?? "",
            ...(images.length ? { images } : {}),
            key,
            ...(turnId ? { codexUser: { turnId, itemId: key } } : {}),
          },
        ];
  }
  if (itemType === "agentMessage") {
    if (phase === "started") {
      return [];
    }
    const text = stringAt(record, "text") ?? textFromContent(record["content"]);
    const questions =
      record["delivery"] === "async" ? parseAsyncQuestions(record["questions"]) : undefined;
    const content = text || (questions ? asyncQuestionText(questions) : "");
    return content
      ? [{ kind: "assistant", text: content, key, ...(questions ? { questions } : {}) }]
      : [];
  }
  if (itemType === "commandExecution") {
    if (phase === "started") {
      return toolNodeForItem({ ...record, turnId }, "running");
    }
    const exitCode = numberAt(record, "exitCode");
    return toolNodeForItem(
      { ...record, turnId },
      record["status"] === "failed" ||
        record["status"] === "declined" ||
        (exitCode !== undefined && exitCode !== 0)
        ? "failed"
        : "done",
    );
  }
  if (itemType === "fileChange") {
    const changes = asArray(record["changes"]);
    const first = asRecord(changes?.[0]);
    const target = stringAt(first, "path") ?? stringAt(first, "file");
    if (phase === "started") {
      return [
        {
          kind: "tool",
          tool: "edit",
          actions: [{ kind: "edit", target }],
          native: { callId: key, turnId, metadata: record },
          label: "File change",
          target,
          status: "running",
          key,
        },
      ];
    }
    return [
      {
        kind: "tool",
        tool: "edit",
        actions: [{ kind: "edit", target }],
        native: { callId: key, turnId, metadata: record },
        label: "File change",
        target,
        status:
          record["status"] === "failed" || record["status"] === "declined" ? "failed" : "done",
        key,
      },
      ...(changes ?? []).flatMap((change): TranscriptNode[] => {
        const entry = asRecord(change);
        const patch = stringAt(entry, "diff");
        const originalPath = stringAt(entry, "path") ?? stringAt(entry, "file");
        const path = stringAt(asRecord(entry?.["kind"]), "movePath") ?? originalPath;
        if (
          patch === undefined ||
          path === undefined ||
          record["status"] === "failed" ||
          record["status"] === "declined"
        )
          return [];
        const kind = stringAt(asRecord(entry?.["kind"]), "type") ?? stringAt(entry, "kind");
        const diff =
          kind === "add" || kind === "delete"
            ? parseFileContents(patch, kind === "add" ? "add" : "del")
            : parseUnifiedDiff(patch);
        return [
          {
            kind: "diff",
            path,
            ...diff,
            callId: key,
            change: kind === "add" ? "add" : kind === "delete" ? "delete" : "update",
            oldPath: path !== originalPath ? originalPath : undefined,
            key: `${key ?? path}:diff:${path}`,
          },
        ];
      }),
    ];
  }
  if (itemType === "reasoning") {
    const text =
      reasoningText(record["summary"]) ??
      reasoningText(record["text"]) ??
      reasoningText(record["content"]);
    if (text === undefined || text.length === 0) {
      return [];
    }
    return [{ kind: "thinking", text, summary: reasoningText(record["summary"]), key }];
  }
  if (itemType === "error") {
    const message = stringAt(record, "message");
    if (message === undefined) {
      return [];
    }
    return [{ kind: "system", level: "error", text: message }];
  }
  return [rawNode(harness, record)];
}

function parseNotification(
  record: Record<string, unknown>,
  harness: HarnessKind,
): TranscriptNode[] {
  const method = stringAt(record, "method");
  if (method === undefined) {
    return [rawNode(harness, record)];
  }
  const params = asRecord(record["params"]) ?? {};
  if (method === "item/commandExecution/outputDelta") {
    const key = stringAt(params, "itemId") ?? stringAt(params, "item_id");
    const delta = stringAt(params, "delta");
    if (!key || !delta) return [];
    return [
      {
        kind: "tool",
        tool: "tool_result",
        label: "Shell",
        key,
        status: "running",
        codex: { output: delta, outputDelta: true },
      },
    ];
  }
  if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
    const delta = stringAt(params, "delta");
    const key = stringAt(params, "itemId") ?? stringAt(params, "item_id");
    if (!delta || key === undefined) return [];
    return [
      {
        kind: "thinking",
        text: delta,
        summary: method === "item/reasoning/summaryTextDelta" ? delta : undefined,
        streaming: true,
        key,
      },
    ];
  }
  if (method === "item/started" || method === "item/completed") {
    const phase = method === "item/started" ? "started" : "completed";
    return parseItem(params["item"], phase, harness, stringAt(params, "turnId"));
  }
  if (method === "item/agentMessage/delta") {
    const delta = stringAt(params, "delta");
    if (delta === undefined || delta.length === 0) {
      return [];
    }
    const itemId =
      stringAt(params, "itemId") ?? stringAt(params, "item_id") ?? "codex-agent-message";
    return [{ kind: "assistant", text: delta, streaming: true, key: itemId }];
  }
  if (method === "turn/completed") {
    const turn = asRecord(params["turn"]);
    const status = stringAt(turn, "status");
    if (status === "failed") {
      const error = asRecord(turn?.["error"]);
      const message = stringAt(error, "message") ?? "unknown failure";
      return [{ kind: "system", level: "error", text: `Turn failed: ${message}` }];
    }
    return [];
  }
  if (method === "error") {
    const error = asRecord(params["error"]);
    const message = stringAt(error, "message") ?? "unknown error";
    const willRetry = params["willRetry"] === true;
    const details = stringAt(error, "additionalDetails")?.trim();
    const modelRetry = willRetry && message.startsWith("Reconnecting");
    const attempt = message.match(/\d+\/\d+/)?.[0] ?? "";
    const cause = details?.replace(/^stream disconnected before completion:\s*/i, "");
    return [
      {
        kind: "system",
        level: willRetry ? "warning" : "error",
        text: willRetry ? `Retrying after error: ${message}` : `Codex error: ${message}`,
        ...(modelRetry
          ? {
              messageKey: cause
                ? "core.transcript.codex_model_retry_details"
                : "core.transcript.codex_model_retry",
              values: { attempt, cause: cause ?? "" },
            }
          : {}),
      },
    ];
  }
  if (method === "warning") {
    const message = stringAt(params, "message");
    return message === undefined ? [] : [{ kind: "system", level: "warning", text: message }];
  }
  if (method.endsWith("/requestApproval")) {
    return [rawNode(harness, record)];
  }
  if (SKIPPED_METHODS.includes(method)) {
    return [];
  }
  return [rawNode(harness, record)];
}

export function parseCodexEvent(raw: unknown, harness: HarnessKind): TranscriptNode[] {
  const record = asRecord(raw);
  if (record === undefined) {
    return [rawNode(harness, raw)];
  }
  if (isJsonRpcResult(record)) {
    return [];
  }
  return parseNotification(record, harness);
}

export function parseCodexHistoryLine(line: string, harness: HarnessKind): TranscriptNode[] {
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
  const type = stringAt(record, "type");
  if (type === "compacted") {
    return [
      {
        kind: "system",
        level: "info",
        text: "Conversation context compacted",
        messageKey: "commands.compacted",
      },
    ];
  }
  if (type === "session_meta" || type === "world_state" || type === "turn_context") {
    return [];
  }
  if (type === "event_msg") {
    const payload = asRecord(record["payload"]);
    const payloadType = stringAt(payload, "type");
    if (payloadType === "exec_command_begin" || payloadType === "exec_command_end") {
      const end = payloadType === "exec_command_end";
      const command = payload?.["command"];
      return toolNodeForItem(
        {
          ...payload,
          id: payload?.["call_id"],
          command: Array.isArray(command) ? command.join(" ") : command,
          aggregatedOutput: payload?.["aggregated_output"] ?? payload?.["stdout"],
        },
        end ? (payload?.["exit_code"] === 0 ? "done" : "failed") : "running",
      );
    }
    if (payloadType === "item_completed") {
      const item = asRecord(payload?.["item"]);
      if (item?.["type"] === "AgentMessage" && item["delivery"] === "async") {
        return parseItem({ ...item, type: "agentMessage" }, "completed", harness);
      }
      if (item?.["type"] !== "FileChange") return [];
      const changes = Object.entries(asRecord(item["changes"]) ?? {}).map(([path, value]) => {
        const change = asRecord(value);
        const kind = stringAt(change, "type");
        return {
          path,
          kind: { type: kind },
          diff: stringAt(change, kind === "update" ? "unified_diff" : "content"),
        };
      });
      return parseItem({ ...item, type: "fileChange", changes }, "completed", harness);
    }
    if (payloadType === "task_complete") {
      const error = asRecord(payload?.["error"]);
      const message = stringAt(error, "message");
      if (message !== undefined) {
        return [{ kind: "system", level: "error", text: `Turn failed: ${message}` }];
      }
      return [];
    }
    if (payloadType === "task_started" || payloadType === "item_started") {
      return [];
    }
    return payloadType === undefined ? [] : [rawNode(harness, payload)];
  }
  if (type === "response_item") {
    const payload = asRecord(record["payload"]);
    if (payload === undefined) {
      return [];
    }
    const itemType = stringAt(payload, "type");
    if (itemType === "message") {
      const role = stringAt(payload, "role");
      const images = contentImages(payload["content"]);
      const text = textFromContent(payload["content"]) ?? "";
      if (!text && !images.length) {
        return [];
      }
      if (role === "user") {
        const metadata = asRecord(payload["internal_chat_message_metadata_passthrough"]);
        const kinds = asArray(metadata?.["content_item_kinds"]);
        if (
          kinds?.length &&
          kinds.every((kind) => typeof kind === "string" && !kind.startsWith("user."))
        ) {
          return [
            {
              kind: "raw",
              harness,
              payload: { type: "session_context", role, text },
              key: stringAt(payload, "id"),
            },
          ];
        }
        const turnId = stringAt(metadata, "turn_id");
        return [
          {
            kind: "user",
            text,
            ...(images.length ? { images } : {}),
            key: stringAt(payload, "id"),
            ...(turnId ? { codexUser: { turnId } } : {}),
          },
        ];
      }
      if (role === "assistant") {
        return [{ kind: "assistant", text, key: stringAt(payload, "id") }];
      }
      if (role === "developer" || role === "system") {
        return [
          {
            kind: "raw",
            harness,
            payload: { type: "session_context", role, text },
            key: stringAt(payload, "id"),
          },
        ];
      }
      return [];
    }
    if (itemType === "function_call" || itemType === "custom_tool_call") {
      const name = stringAt(payload, "name") ?? "tool";
      const input = parseArguments(payload["arguments"] ?? payload["input"]);
      if (/(?:^|\.)request_user_input_async$/.test(name)) {
        const questions = parseAsyncQuestions(input?.["questions"]);
        if (questions)
          return [
            {
              kind: "assistant",
              text: asyncQuestionText(questions),
              questions,
              key: stringAt(payload, "call_id") ?? stringAt(payload, "id"),
            },
          ];
      }
      return [
        {
          kind: "tool",
          tool: name,
          label: name,
          actions: ["exec_command", "shell_command", "shell"].includes(name)
            ? codexCommandFallback(input?.["cmd"] ?? input?.["command"])
            : nativeToolActions(name, input, "codex"),
          actionSource: "fallback",
          native: { callId: stringAt(payload, "call_id"), metadata: payload },
          codex: { input: input ?? payload["arguments"] ?? payload["input"] },
          target: toolTargetFromInput(input),
          detailText: codexOutputText(input ?? payload["arguments"] ?? payload["input"]),
          status: "running",
          key: stringAt(payload, "call_id") ?? stringAt(payload, "id"),
        },
      ];
    }
    if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
      const output = payload["output"];
      const record = parseArguments(output);
      const exitCode = numberAt(record, "exit_code") ?? numberAt(record, "exitCode");
      return [
        {
          kind: "tool",
          tool: "tool_result",
          label: "Result",
          codex: { output },
          status:
            record?.["is_error"] === true || (exitCode !== undefined && exitCode !== 0)
              ? "failed"
              : "done",
          detailText: codexOutputText(output),
          key: stringAt(payload, "call_id") ?? stringAt(payload, "id"),
        },
      ];
    }
    if (itemType === "reasoning") {
      const text = reasoningText(payload["summary"]);
      if (text !== undefined)
        return [{ kind: "thinking", text, summary: text, key: stringAt(payload, "id") }];
      return [];
    }
    return [rawNode(harness, payload)];
  }
  return [rawNode(harness, record)];
}
