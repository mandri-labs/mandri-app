import { nativeToolActions } from "./nativeTools";
import type { HarnessKind } from "@/daemon/types/ws";
import type { ParseContext, TranscriptNode } from "./types";
import {
  asArray,
  asRecord,
  numberAt,
  outputText,
  parseUnifiedDiff,
  rawNode,
  stringAt,
} from "./shared";

function stepKey(record: Record<string, unknown>, context?: ParseContext): string | undefined {
  const index = numberAt(record, "step_index") ?? numberAt(record, "stepIdx");
  if (index !== undefined) return `agy:${context?.sessionId ?? "session"}:${index}`;
  const call = asRecord(record["tool_info"] ?? record["toolCall"]);
  const id = stringAt(call, "id");
  return id ? `agy:${context?.sessionId ?? "session"}:call:${id}` : undefined;
}

function userText(text: string): string {
  return (
    /^<USER_REQUEST>\s*((?:(?!<\/?USER_REQUEST>)[\s\S])*?)\s*<\/USER_REQUEST>(?:\s*<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>)?(?:\s*<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>)?\s*$/.exec(
      text,
    )?.[1] ?? text
  );
}

export function createAgyHistoryContext(
  lines: readonly string[],
): Pick<ParseContext, "agyToolCalls" | "agyTaskResults"> {
  const records = new Map<number, Record<string, unknown>>();
  for (const line of lines) {
    try {
      const record = asRecord(JSON.parse(line));
      const index = numberAt(record, "step_index");
      if (record && index !== undefined) records.set(index, record);
    } catch {
      /* Non-JSON history remains available through the raw parser. */
    }
  }
  const agyToolCalls = new Map<number, Record<string, unknown>>();
  const tasks = new Map<string, number>();
  const agyTaskResults = new Map<
    number,
    { noticeIndex: number; output: string; exitCode: number }
  >();
  for (const [index, record] of records) {
    if (record["type"] !== "PLANNER_RESPONSE") continue;
    const calls = asArray(record["tool_calls"]);
    if (!calls?.length) continue;
    for (const [offset, raw] of calls.entries()) {
      const call = asRecord(raw);
      const result = records.get(index + offset + 1);
      if (!call || result?.["type"] !== "GENERIC" || result["source"] !== "MODEL") break;
      agyToolCalls.set(index + offset + 1, call);
    }
  }
  for (const [index, record] of records) {
    if (record["type"] !== "GENERIC" || record["source"] !== "MODEL") continue;
    const taskId = /(?:^|\n)Tool is running as a background task with task id: ([^\s]+)\n/.exec(
      stringAt(record, "content") ?? "",
    )?.[1];
    if (taskId) tasks.set(taskId, index);
  }
  for (const [noticeIndex, record] of records) {
    if (record["type"] !== "SYSTEM_MESSAGE" || record["source"] !== "SYSTEM") continue;
    const content = stringAt(record, "content") ?? "";
    const result =
      /\[Message\] timestamp=\S+ sender=(\S+) priority=\S+ content=Task id "([^"\n]+)" finished with result:\n\nThe command exited with code (-?\d+)\.\nOutput:\n([\s\S]*)\n\n<\/SYSTEM_MESSAGE>$/.exec(
        content,
      );
    const taskId = result?.[1];
    const index = taskId ? tasks.get(taskId) : undefined;
    if (result && index !== undefined && taskId === result[2])
      agyTaskResults.set(index, {
        noticeIndex,
        output: result[4] ?? "",
        exitCode: Number(result[3]),
      });
  }
  return { agyToolCalls, agyTaskResults };
}

function historyOutput(text: string): string {
  return (
    /^Created At: [^\n]+\nCompleted At: [^\n]+\n\nThe command exited with code -?\d+\.\nOutput:\n([\s\S]*)$/.exec(
      text,
    )?.[1] ?? text
  );
}

function systemText(text: string): string {
  return (
    /^(?:The following is a <SYSTEM_MESSAGE> not actually sent by the user\. It is provided by the system as important information to pay attention to\.\s*)?<SYSTEM_MESSAGE>((?:(?!<\/?SYSTEM_MESSAGE>)[\s\S])*)<\/SYSTEM_MESSAGE>\s*$/
      .exec(text)?.[1]
      ?.trim() ?? text
  );
}

function inputNode(text: string, key?: string): TranscriptNode {
  const system = /^<SYSTEM_MESSAGE>((?:(?!<\/?SYSTEM_MESSAGE>)[\s\S])*)<\/SYSTEM_MESSAGE>$/.exec(
    text,
  );
  return system
    ? { kind: "system", key, level: "info", text: system[1] ?? "" }
    : { kind: "user", key, text: userText(text) };
}

function emptyStepNodes(
  record: Record<string, unknown>,
  harness: HarnessKind,
  raw: unknown,
  key?: string,
): TranscriptNode[] {
  const metadata = new Set([
    "conversation_id",
    "step_index",
    "state",
    "step_type",
    "duration_seconds",
    "text",
    "text_delta",
  ]);
  return Object.keys(record).some((field) => !metadata.has(field))
    ? [{ kind: "raw", key, harness, payload: raw }]
    : [];
}

function toolNodes(record: Record<string, unknown>, key?: string): TranscriptNode[] {
  const info = asRecord(record["tool_info"]) ?? record;
  const input = asRecord(info["parameters"] ?? info["args"]);
  const tool = stringAt(info, "name") ?? stringAt(record, "tool_name") ?? "tool";
  const error = info["error"] ?? record["error"];
  const state = stringAt(record, "state") ?? stringAt(record, "status");
  const output = info["output"];
  const target =
    stringAt(input, "CommandLine") ??
    stringAt(input, "TargetFile") ??
    stringAt(input, "AbsolutePath") ??
    stringAt(input, "FilePath") ??
    stringAt(input, "Url") ??
    stringAt(input, "CommandId");
  const nodes: TranscriptNode[] = [
    {
      kind: "tool",
      key,
      tool,
      label: tool,
      title: stringAt(input, "toolSummary") ?? stringAt(input, "description"),
      target,
      actions: nativeToolActions(tool, input, "agy").map((action) => ({
        ...action,
        target: action.target ?? target,
      })),
      durationMs:
        numberAt(record, "duration_seconds") === undefined
          ? undefined
          : numberAt(record, "duration_seconds")! * 1000,
      native: {
        callId: stringAt(info, "id") ?? key,
        sessionId: stringAt(record, "conversation_id") ?? stringAt(record, "conversationId"),
        partId: stringAt(record, "step_id") ?? stringAt(info, "step_id"),
        parentCallId: stringAt(record, "parent_trajectory_id"),
        metadata: info,
        subagents: asRecord(record["subagent_info"])?.["subagents"],
      },
      status:
        error || state === "ERROR"
          ? "failed"
          : state === "DONE"
            ? "done"
            : state === "CANCELED" || state === "CANCELLED"
              ? "cancelled"
              : state === "WAITING_FOR_USER"
                ? "waiting"
                : "running",
      detailText: outputText(error ?? output ?? input),
      details: { input, output: error ?? output },
    },
  ];
  const patch = stringAt(asRecord(output), "diff") ?? stringAt(info, "diff");
  if (patch && target && !error && state === "DONE")
    nodes.push({
      kind: "diff",
      callId: key,
      path: target,
      ...parseUnifiedDiff(patch),
      key: key ? `${key}:diff` : undefined,
    });
  return nodes;
}

export function parseAgyEvent(
  raw: unknown,
  harness: HarnessKind,
  context?: ParseContext,
): TranscriptNode[] {
  const record = asRecord(raw);
  if (!record) return [rawNode(harness, raw)];
  const event = stringAt(record, "event");
  if (event === "init") return [];
  if (event === "hook") {
    const data = asRecord(record["data"]);
    const call = asRecord(data?.["toolCall"]);
    if (data && call && (record["hook"] === "PreToolUse" || record["hook"] === "PostToolUse")) {
      const result = asRecord(data["toolResult"]);
      return toolNodes(
        {
          ...data,
          tool_info: {
            ...call,
            output: result?.["result"] ?? data["toolResult"],
            error: result?.["error"],
          },
          state: record["hook"] === "PreToolUse" ? "ACTIVE" : "DONE",
        },
        stepKey(data, context),
      );
    }
    return [rawNode(harness, raw)];
  }
  if (event === "step_update") {
    const step = asRecord(record["step_update"]);
    if (!step) return [rawNode(harness, raw)];
    const key = stepKey(step, context);
    const type = stringAt(step, "step_type");
    const text = stringAt(step, "text_delta") ?? stringAt(step, "text") ?? "";
    if (step["state"] === "ERROR" && type !== "tool") {
      return [
        {
          kind: "system",
          key: key ? `${key}:error` : undefined,
          level: "error",
          text: outputText(step["error"]) || text || JSON.stringify(step),
        },
      ];
    }
    if (type === "user_input")
      return text.trim() ? [inputNode(text, key)] : emptyStepNodes(step, harness, raw, key);
    if (type === "agent_response" || type === "thinking" || type === "reasoning") {
      return [
        {
          kind: type === "agent_response" ? "assistant" : "thinking",
          text,
          key,
          streaming: step["state"] === "ACTIVE",
          delta: typeof step["text_delta"] === "string" || typeof step["text"] !== "string",
        },
      ];
    }
    if (type === "tool") {
      const nodes = toolNodes(step, key);
      const subagents = asArray(asRecord(step["subagent_info"])?.["subagents"]);
      if (subagents?.length)
        nodes.push({
          kind: "raw",
          key: key ? `${key}:subagents` : undefined,
          harness,
          payload: { event: "subagents", subagents },
        });
      return nodes;
    }
    if (type === "system_message") {
      return text.trim()
        ? [{ kind: "system", key, level: "info", text: systemText(text) }]
        : emptyStepNodes(step, harness, raw, key);
    }
    return [{ kind: "raw", key, harness, payload: raw }];
  }
  if (event === "result") {
    const result = asRecord(record["result"]) ?? record;
    const nodes: TranscriptNode[] = [];
    const command = asRecord(result["command"]);
    if (command && result["status"] === "SUCCESS")
      nodes.push({
        kind: "system",
        level: "info",
        text:
          outputText(result["response"]) ||
          outputText(command["data"]) ||
          stringAt(command, "name") ||
          JSON.stringify(command),
      });
    const denied = asArray(result["denied_actions"]);
    if (denied?.length)
      nodes.push({
        kind: "system",
        level: "warning",
        text: "",
        messageKey: "core.transcript.agy_denied_actions",
        values: {
          actions: denied
            .map((action) => outputText(asRecord(action)?.["display_name"] ?? action))
            .join(", "),
        },
      });
    if (result["status"] !== "SUCCESS")
      nodes.push({
        kind: "system",
        level: "error",
        text: outputText(result["error"] ?? result["response"] ?? result) ?? "",
      });
    const usage = asRecord(result["usage"]);
    const tokens = numberAt(usage, "total_tokens");
    if (tokens !== undefined && tokens > 0)
      nodes.push({
        kind: "system",
        level: "info",
        text: "",
        messageKey: "core.transcript.agy_usage",
        values: { tokens },
      });
    if (usage) nodes.push({ kind: "raw", harness, payload: raw });
    return nodes;
  }
  if (event === "command") {
    const command = asRecord(record["command"]);
    return [
      {
        kind: "system",
        level: "info",
        text: outputText(command?.["output"] ?? command?.["data"] ?? command ?? raw) ?? "",
      },
    ];
  }
  return [rawNode(harness, raw)];
}

export function parseAgyHistoryLine(
  line: string,
  harness: HarnessKind,
  context?: ParseContext,
): TranscriptNode[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [rawNode(harness, line)];
  }
  const record = asRecord(value);
  if (!record) return [rawNode(harness, value)];
  if (record["event"]) return parseAgyEvent(record, harness, context);
  const key = stepKey(record, context);
  const text = stringAt(record, "content") ?? "";
  if (record["type"] === "USER_INPUT") return [inputNode(text, key)];
  if (record["type"] === "SYSTEM_MESSAGE") {
    const index = numberAt(record, "step_index");
    if (
      Array.from(context?.agyTaskResults?.values() ?? []).some(
        (result) => result.noticeIndex === index,
      )
    )
      return [];
    return text ? [{ kind: "system", key, level: "info", text: systemText(text) }] : [];
  }
  const calls = asArray(record["tool_calls"]);
  if (record["type"] === "PLANNER_RESPONSE") {
    const nodes: TranscriptNode[] = text ? [{ kind: "assistant", key, text }] : [];
    const index = numberAt(record, "step_index");
    const unresolved = calls?.filter(
      (_, offset) => index === undefined || !context?.agyToolCalls?.has(index + offset + 1),
    );
    if (unresolved?.length)
      nodes.push({
        kind: "raw",
        key: key ? `${key}:calls` : undefined,
        harness,
        payload: { ...record, tool_calls: unresolved },
      });
    return nodes;
  }
  if (calls?.length)
    return calls.flatMap((call, index) =>
      toolNodes(
        { ...record, tool_info: { ...asRecord(call), output: text || undefined } },
        index === 0 ? key : `${key}:${index}`,
      ),
    );
  if (record["type"] === "GENERIC" && text) {
    const call = context?.agyToolCalls?.get(numberAt(record, "step_index") ?? -1);
    const completed = context?.agyTaskResults?.get(numberAt(record, "step_index") ?? -1);
    const exitCode =
      completed?.exitCode ?? /\nThe command exited with code (-?\d+)\./.exec(text)?.[1];
    const output = completed?.output ?? historyOutput(text);
    return toolNodes(
      {
        ...record,
        status:
          exitCode !== undefined ? (Number(exitCode) !== 0 ? "ERROR" : "DONE") : record["status"],
        tool_info: { ...call, name: stringAt(call, "name") ?? "tool_result", output },
      },
      key,
    );
  }
  return [{ kind: "raw", key, harness, payload: value }];
}
