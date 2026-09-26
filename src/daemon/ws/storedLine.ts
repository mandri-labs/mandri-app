import { parseHistoryLine } from "@/features/transcript/parse";
import type { ParseContext } from "@/features/transcript/parse";
import type { HarnessKind } from "@/daemon/types/ws";

export function storedLineKey(harness: HarnessKind, line: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < line.length; index += 1) {
    const value = line.charCodeAt(index);
    first = Math.imul(first ^ value, 16777619);
    second = Math.imul(second, 33) ^ value;
  }
  return `stored:${harness}:${first >>> 0}:${second >>> 0}`;
}

export function parseStoredLine(harness: HarnessKind, line: string, context?: ParseContext) {
  const key = storedLineKey(harness, line);
  return parseHistoryLine(harness, line, context).map((node, index) => ({
    ...node,
    key: ("key" in node ? node.key : undefined) ?? `${key}:${index}`,
  }));
}
