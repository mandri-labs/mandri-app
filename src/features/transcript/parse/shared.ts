import type { HarnessKind } from "@/daemon/types/ws";
import type { TranscriptDiffLine, TranscriptNode } from "./types";

type RecordOf = Record<string, unknown>;

export function outputText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map((block) => outputText(asRecord(block)?.["text"] ?? block) ?? "").join("\n");
  return JSON.stringify(value, null, 2);
}

export function parseArguments(value: unknown): RecordOf | undefined {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): RecordOf | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as RecordOf;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function stringAt(record: RecordOf | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export function numberAt(record: RecordOf | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanAt(record: RecordOf | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function rawNode(harness: HarnessKind, payload: unknown): TranscriptNode {
  return { kind: "raw", harness, payload };
}

export function toolTargetFromInput(input: RecordOf | undefined): string | undefined {
  return (
    stringAt(input, "file_path") ??
    stringAt(input, "filePath") ??
    stringAt(input, "command") ??
    stringAt(input, "cmd") ??
    stringAt(input, "path") ??
    stringAt(input, "url") ??
    stringAt(input, "pattern") ??
    stringAt(input, "query")
  );
}

export function parseUnifiedDiff(patch: string): {
  additions: number;
  deletions: number;
  lines: TranscriptDiffLine[];
} {
  const lines: import("./types").TranscriptDiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldNo: number | undefined;
  let newNo: number | undefined;
  for (const line of patch.split(/\r?\n/)) {
    if (
      line.length === 0 ||
      line.startsWith("diff ") ||
      line.startsWith("Index:") ||
      line.startsWith("===") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("\\ No newline")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match !== null) {
        oldNo = Number.parseInt(match[1] ?? "0", 10);
        newNo = Number.parseInt(match[2] ?? "0", 10);
      }
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      lines.push({ type: "add", text: line.slice(1), newNo });
      if (newNo !== undefined) newNo += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
      lines.push({ type: "del", text: line.slice(1), oldNo });
      if (oldNo !== undefined) oldNo += 1;
      continue;
    }
    if (!line.startsWith(" ")) continue;
    const contextText = line.startsWith(" ") ? line.slice(1) : line;
    lines.push({ type: "context", text: contextText, oldNo, newNo });
    if (oldNo !== undefined) oldNo += 1;
    if (newNo !== undefined) newNo += 1;
  }
  return { additions, deletions, lines };
}

// Codex add/delete changes carry literal file contents, not a unified patch.
export function parseFileContents(content: string, type: "add" | "del") {
  const text = content.split(/\r?\n/);
  if (text.at(-1) === "") text.pop();
  const lines: TranscriptDiffLine[] = text.map((text, index) => ({
    type,
    text,
    ...(type === "add" ? { newNo: index + 1 } : { oldNo: index + 1 }),
  }));
  return {
    lines,
    additions: type === "add" ? lines.length : 0,
    deletions: type === "del" ? lines.length : 0,
  };
}
