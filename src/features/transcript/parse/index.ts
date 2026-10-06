import type { HarnessKind } from "@/daemon/types/ws";
import { parseAgyEvent, parseAgyHistoryLine } from "./agy";
import { parseClaudeEvent, parseClaudeHistoryLine } from "./claude";
import { parseCodexEvent, parseCodexHistoryLine } from "./codex";
import { parseOpenCodeEvent, parseOpenCodeHistoryLine } from "./opencode";
import { parsePiEvent, parsePiHistoryLine } from "./pi";
import type { ParseContext, TranscriptNode } from "./types";
import { parseArguments } from "./shared";

export type {
  ParseContext,
  TranscriptDiffLine,
  TranscriptDiffLineType,
  TranscriptNode,
  TranscriptPlanStep,
  TranscriptPlanStepStatus,
  TranscriptToolStatus,
} from "./types";
export { parseUnifiedDiff } from "./shared";
export { createAgyHistoryContext } from "./agy";

export function parseFrame(
  harness: HarnessKind,
  raw: unknown,
  context?: ParseContext,
): TranscriptNode[] {
  switch (harness) {
    case "agy":
      return parseAgyEvent(raw, harness, context);
    case "claude":
      return parseClaudeEvent(raw, harness, context);
    case "codex":
      return parseCodexEvent(raw, harness);
    case "opencode":
      return parseOpenCodeEvent(raw, harness, context);
    case "pi":
      return parsePiEvent(raw, harness, context);
  }
}

export function parseHistoryLine(
  harness: HarnessKind,
  line: string,
  context?: ParseContext,
): TranscriptNode[] {
  if (/^\s*\{\s*"type"\s*:\s*"mandri\.transcript_record"\s*,/.test(line)) {
    const record = parseArguments(line);
    if (typeof record?.["byte_length"] === "number") {
      const nativeKind = record["event_kind"];
      const eventKind =
        nativeKind === "compaction" || nativeKind === "command" || nativeKind === "file_change"
          ? nativeKind
          : harness === "codex"
            ? codexRecordKind(record)
            : undefined;
      return [
        {
          kind: "record",
          preview: typeof record["preview"] === "string" ? record["preview"] : undefined,
          ...(eventKind ? { eventKind } : {}),
          byteLength: record["byte_length"],
          key:
            typeof record["record_token"] === "string"
              ? `record:${record["record_token"]}`
              : undefined,
        },
      ];
    }
  }
  switch (harness) {
    case "agy":
      return parseAgyHistoryLine(line, harness, context);
    case "claude":
      return parseClaudeHistoryLine(line, harness);
    case "codex":
      return parseCodexHistoryLine(line, harness);
    case "opencode":
      return parseOpenCodeHistoryLine(line, harness, context);
    case "pi":
      return parsePiHistoryLine(line, harness);
  }
}

export { createClaudeStreamState } from "./claudeStream";

function codexRecordKind(
  record: Record<string, unknown>,
): "compaction" | "command" | "file_change" | undefined {
  if (record["original_type"] === "compacted") return "compaction";
  if (record["original_type"] !== "event_msg" || record["original_event_type"] !== "item_completed")
    return undefined;
  switch (record["original_item_type"]) {
    case "ContextCompaction":
      return "compaction";
    case "CommandExecution":
      return "command";
    case "FileChange":
      return "file_change";
    default:
      return undefined;
  }
}
