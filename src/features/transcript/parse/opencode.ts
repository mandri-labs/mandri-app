import { nativeToolActions } from "./nativeTools";
import { opencodeNotification, opencodeNotificationNode } from "./opencodeNotifications";
import { opencodeTodos } from "./opencodeTodos";
import { contentImages } from "./images";
import type { HarnessKind } from "@/daemon/types/ws";
import type { ParseContext, TranscriptNode } from "./types";
import {
  asArray,
  asRecord,
  numberAt,
  outputText,
  parseFileContents,
  parseUnifiedDiff,
  rawNode,
  stringAt,
  toolTargetFromInput,
} from "./shared";

const SILENT_EVENT_TYPES: readonly string[] = [
  "server.connected",
  "server.heartbeat",
  "session.updated",
  "message.updated",
  "session.status",
  "session.idle",
  "file.edited",
  "file.watcher.updated",
  "plugin.added",
  "catalog.updated",
  "reference.updated",
  "integration.updated",
  "todo.updated",
  "session.agent.selected",
];

function parseTextPart(
  part: Record<string, unknown>,
  context: ParseContext | undefined,
): TranscriptNode[] {
  const text = stringAt(part, "text");
  if (text === undefined || text.length === 0) {
    return [];
  }
  const messageId = stringAt(part, "messageID");
  const role = messageId === undefined ? undefined : context?.messageRoles?.get(messageId);
  const key = stringAt(part, "id") ?? messageId;
  if (role === "user") {
    return [{ kind: "user", text, ...(key ? { key } : {}), ...(messageId ? { messageId } : {}) }];
  }
  const notification = opencodeNotificationNode(text, key);
  if (notification) return [notification];
  return [key === undefined ? { kind: "assistant", text } : { kind: "assistant", text, key }];
}

function parseReasoningPart(part: Record<string, unknown>): TranscriptNode[] {
  const text = stringAt(part, "text");
  if (text === undefined || text.length === 0) {
    return [];
  }
  const key = stringAt(part, "id") ?? stringAt(part, "messageID");
  return [key === undefined ? { kind: "thinking", text } : { kind: "thinking", text, key }];
}

function parseToolPart(part: Record<string, unknown>): TranscriptNode[] {
  const todos = opencodeTodos(part);
  if (todos) return [todos];
  const state = asRecord(part["state"]);
  const input = asRecord(state?.["input"]);
  const statusRaw = stringAt(state, "status");
  const output = outputText(state?.["output"] ?? state?.["error"]);
  const notification = output ? opencodeNotification(output) : undefined;
  const tool = notification?.tool ?? stringAt(part, "tool") ?? "tool";
  const actionInput =
    notification?.tool === "shell" ? { ...input, command: notification.target } : input;
  const status =
    statusRaw === "error" || notification?.state === "error"
      ? "failed"
      : statusRaw === "cancelled" || notification?.state === "cancelled"
        ? "cancelled"
        : statusRaw === "completed"
          ? "done"
          : statusRaw === "pending"
            ? "pending"
            : "running";
  const title = stringAt(state, "title");
  const time = asRecord(state?.["time"]);
  const start = numberAt(time, "start");
  const end = numberAt(time, "end");
  const durationMs =
    start !== undefined && end !== undefined && end >= start ? end - start : undefined;
  const key = stringAt(part, "callID") ?? stringAt(part, "id");
  const node: TranscriptNode = {
    kind: "tool",
    tool,
    label: tool,
    title:
      (notification?.tool === "subagent" ? notification.target : undefined) ??
      stringAt(input, "description") ??
      (nativeToolActions(tool, input, "opencode")[0]?.kind === "tool" ? title : undefined),
    actions: nativeToolActions(tool, actionInput, "opencode"),
    native: {
      callId: key,
      partId: stringAt(part, "id"),
      messageId: stringAt(part, "messageID"),
      sessionId: stringAt(part, "sessionID"),
      startedAt: start,
      metadata: { ...asRecord(state?.["metadata"]), title },
      attachments: state?.["attachments"],
    },
    details: { input, output: state?.["output"] ?? state?.["error"] },
    target: notification?.target ?? toolTargetFromInput(input),
    detailText: notification
      ? notification.output.trim() === "(no output)" || !notification.output.trim()
        ? undefined
        : notification.output
      : outputText(state?.["output"] ?? state?.["error"] ?? input),
    status,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(key === undefined ? {} : { key }),
  };
  if (status !== "done") {
    return [node];
  }
  const metadata = asRecord(state?.["metadata"]);
  const files = asArray(metadata?.["files"]);
  if (files?.length) {
    return [
      node,
      ...files.flatMap((file): TranscriptNode[] => {
        const entry = asRecord(file);
        const path =
          stringAt(entry, "movePath") ??
          stringAt(entry, "file") ??
          stringAt(entry, "filePath") ??
          stringAt(entry, "relativePath");
        const patch = stringAt(entry, "patch") ?? stringAt(entry, "diff");
        if (!path || patch === undefined) return [];
        const type = stringAt(entry, "status") ?? stringAt(entry, "type");
        return [
          {
            kind: "diff",
            path,
            ...parseUnifiedDiff(patch),
            callId: key,
            change:
              type === "add" || type === "added"
                ? "add"
                : type === "delete" || type === "deleted"
                  ? "delete"
                  : "update",
            oldPath: entry?.["movePath"] ? stringAt(entry, "filePath") : undefined,
            key: `${key ?? path}:diff:${path}`,
          },
        ];
      }),
    ];
  }
  const patch = stringAt(metadata, "diff");
  if (patch === undefined || patch.length === 0) {
    const content = stringAt(input, "content");
    const path = stringAt(input, "path") ?? stringAt(input, "filePath");
    if (
      tool === "write" &&
      path &&
      content !== undefined &&
      output?.startsWith("Created file successfully:")
    ) {
      return [
        node,
        {
          kind: "diff",
          path,
          change: "add",
          callId: key,
          key: `${key ?? path}:diff:${path}`,
          ...parseFileContents(content.replace(/^\uFEFF/, ""), "add"),
        },
      ];
    }
    return [node];
  }
  const counts = parseUnifiedDiff(patch);
  const path =
    stringAt(input, "filePath") ??
    stringAt(metadata, "filepath") ??
    stringAt(asRecord(metadata?.["filediff"]), "file") ??
    "unknown";
  const diffNode: TranscriptNode = {
    kind: "diff",
    callId: key,
    change: "update",
    key: key ? `${key}:diff` : undefined,
    path,
    additions: counts.additions,
    deletions: counts.deletions,
    lines: parseUnifiedDiff(patch).lines,
  };
  return [node, diffNode];
}

function parsePartUpdated(
  part: unknown,
  harness: HarnessKind,
  context: ParseContext | undefined,
): TranscriptNode[] {
  const record = asRecord(part);
  if (record === undefined) {
    return [rawNode(harness, part)];
  }
  const type = stringAt(record, "type");
  if (type === "compaction") {
    const status = stringAt(record, "status");
    return [
      {
        kind: "compaction",
        status: status === "completed" || status === "failed" ? status : "running",
        text: stringAt(record, "summary") ?? "",
        reason: stringAt(record, "reason"),
        error: stringAt(asRecord(record["error"]), "message"),
        key: stringAt(record, "id"),
      },
    ];
  }
  if (type === "file_snapshot") {
    const turnId = stringAt(record, "turnID");
    return [
      {
        kind: "file_snapshot",
        scope: "turn",
        turnId,
        key: `opencode:files:${turnId ?? stringAt(record, "id")}`,
        files: parseSessionDiff({ diff: record["files"] }, harness).filter(
          (node): node is Extract<TranscriptNode, { kind: "diff" }> => node.kind === "diff",
        ),
      },
    ];
  }
  if (type === "text") {
    return parseTextPart(record, context);
  }
  if (type === "file" && stringAt(record, "mime")?.startsWith("image/")) {
    return [
      {
        kind: "user",
        text: "",
        images: contentImages([record]),
        key: stringAt(record, "id"),
        messageId: stringAt(record, "messageID"),
      },
    ];
  }
  if (type === "reasoning") {
    return parseReasoningPart(record);
  }
  if (type === "tool") {
    return parseToolPart(record);
  }
  if (type === "step-start" || type === "step-finish") {
    return [rawNode(harness, record)];
  }
  return [rawNode(harness, record)];
}

function parseDelta(
  properties: Record<string, unknown>,
  context: ParseContext | undefined,
  harness: HarnessKind,
): TranscriptNode[] {
  const field = stringAt(properties, "field");
  if (field !== "text") {
    return [rawNode(harness, properties)];
  }
  const delta = stringAt(properties, "delta");
  if (delta === undefined || delta.length === 0) {
    return [];
  }
  const partId = stringAt(properties, "partID") ?? stringAt(properties, "partId");
  const kind = partId === undefined ? undefined : context?.partKinds?.get(partId);
  if (kind === "reasoning") {
    return [
      partId === undefined
        ? { kind: "thinking", text: delta, streaming: true }
        : { kind: "thinking", text: delta, streaming: true, key: partId },
    ];
  }
  return [
    partId === undefined
      ? { kind: "assistant", text: delta, streaming: true }
      : { kind: "assistant", text: delta, streaming: true, key: partId },
  ];
}

function parseSessionDiff(
  properties: Record<string, unknown>,
  harness: HarnessKind,
): TranscriptNode[] {
  const diffs = asArray(properties["diff"]) ?? [];
  const nodes: TranscriptNode[] = [];
  for (const element of diffs) {
    const record = asRecord(element);
    if (record === undefined) {
      nodes.push(rawNode(harness, element));
      continue;
    }
    const path =
      stringAt(record, "file") ?? stringAt(record, "path") ?? stringAt(record, "file_path");
    const patch = stringAt(record, "patch") ?? stringAt(record, "diff");
    if (patch !== undefined && patch.length > 0) {
      const parsed = parseUnifiedDiff(patch);
      nodes.push({
        kind: "diff",
        path: path ?? "unknown",
        change:
          record["status"] === "added"
            ? "add"
            : record["status"] === "deleted"
              ? "delete"
              : "update",
        additions: parsed.additions,
        deletions: parsed.deletions,
        lines: parsed.lines,
      });
      continue;
    }
    const additions = numberAt(record, "additions") ?? numberAt(record, "added");
    const deletions = numberAt(record, "deletions") ?? numberAt(record, "removed");
    if (path !== undefined && additions !== undefined && deletions !== undefined) {
      nodes.push({ kind: "diff", path, additions, deletions });
      continue;
    }
    nodes.push(rawNode(harness, element));
  }
  return nodes;
}

function parseSessionError(
  properties: Record<string, unknown>,
  harness: HarnessKind,
): TranscriptNode[] {
  const message = stringAt(properties, "message");
  if (message !== undefined) {
    return [{ kind: "system", level: "error", text: message }];
  }
  const error = asRecord(properties["error"]);
  const errorText = stringAt(error, "message") ?? stringAt(properties, "detail");
  if (errorText !== undefined) {
    return [{ kind: "system", level: "error", text: errorText }];
  }
  return [rawNode(harness, properties)];
}

export function parseOpenCodeEvent(
  raw: unknown,
  harness: HarnessKind,
  context?: ParseContext,
): TranscriptNode[] {
  const record = asRecord(raw);
  if (record === undefined) {
    return [rawNode(harness, raw)];
  }
  const type = stringAt(record, "type");
  if (type === undefined) {
    return [rawNode(harness, record)];
  }
  const properties = asRecord(record["properties"]);
  if (properties === undefined) {
    return SILENT_EVENT_TYPES.includes(type) ? [] : [rawNode(harness, record)];
  }
  if (type === "message.part.updated") {
    return parsePartUpdated(properties["part"], harness, context);
  }
  if (type === "message.part.delta") {
    return parseDelta(properties, context, harness);
  }
  if (type === "session.diff") {
    const turnId = stringAt(properties, "turnID");
    if (properties["scope"] === "turn" && asArray(properties["diff"])?.length === 0) return [];
    return [
      {
        kind: "file_snapshot",
        scope: properties["scope"] === "turn" ? "turn" : "session",
        turnId,
        key: `opencode:files:${turnId ?? stringAt(properties, "sessionID") ?? "session"}`,
        files: parseSessionDiff(properties, harness).filter(
          (node): node is Extract<TranscriptNode, { kind: "diff" }> => node.kind === "diff",
        ),
      },
    ];
  }
  if (type === "session.error") {
    return parseSessionError(properties, harness);
  }
  if (SILENT_EVENT_TYPES.includes(type)) {
    return [];
  }
  return [rawNode(harness, record)];
}

export function parseOpenCodeHistoryLine(
  line: string,
  harness: HarnessKind,
  context?: ParseContext,
): TranscriptNode[] {
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
  if (stringAt(record, "type") !== undefined) {
    return parseOpenCodeEvent(record, harness, context);
  }
  return [rawNode(harness, record)];
}
