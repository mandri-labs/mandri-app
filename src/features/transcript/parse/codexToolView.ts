import { asRecord, toolTargetFromInput } from "./shared";

export interface CodexResultSection {
  text?: string;
  fields?: Record<string, unknown>;
  exitCode?: number;
  durationMs?: number;
}

export function codexResultSections(value: unknown, depth = 0): CodexResultSection[] {
  if (value === undefined || value === null) return [];
  if (depth > 12) return [{ fields: { value } }];
  const next = (entry: unknown) => codexResultSections(entry, depth + 1);
  if (Array.isArray(value)) return value.flatMap(next);
  const record = asRecord(value);
  if (record) {
    if (
      ["input_text", "output_text", "text"].includes(String(record.type)) &&
      typeof record.text === "string"
    )
      return next(record.text);
    if (Array.isArray(record.content)) return next(record.content);
    if (
      "output" in record &&
      ("exit_code" in record ||
        "chunk_id" in record ||
        "wall_time_seconds" in record ||
        "session_id" in record)
    ) {
      const sections = next(record.output);
      const metadata = {
        exitCode: typeof record.exit_code === "number" ? record.exit_code : undefined,
        durationMs:
          typeof record.wall_time_seconds === "number"
            ? record.wall_time_seconds * 1000
            : undefined,
      };
      return sections.length
        ? sections.map((section) => ({ ...section, ...metadata }))
        : [metadata];
    }
    return [{ fields: record }];
  }
  if (typeof value !== "string") return [{ text: String(value) }];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (["[", "{", '"'].includes(trimmed[0] ?? "")) {
    try {
      return next(JSON.parse(trimmed));
    } catch {
      /* Incomplete streams remain readable until completed. */
    }
  }
  const envelope = /^Script (?:completed|running)[\s\S]*?\bOutput:\s*\r?\n?/.exec(value);
  if (envelope) return next(value.slice(envelope[0].length));
  const lines = value.split(/\r?\n/);
  if (
    lines.length > 1 &&
    lines.some((line) => {
      try {
        const r = asRecord(JSON.parse(line));
        return r && ("output" in r || "content" in r);
      } catch {
        return false;
      }
    })
  )
    return lines.flatMap(next);
  return [{ text: value }];
}

export function codexToolTitle(tool: string, input: unknown): string {
  const record = asRecord(input);
  const target = toolTargetFromInput(record);
  if (target) return target;
  const questions = record?.questions;
  if (Array.isArray(questions)) {
    const first = asRecord(questions[0]);
    if (typeof first?.question === "string") return first.question;
  }
  for (const field of ["task_name", "target", "agent_id"]) {
    if (typeof record?.[field] === "string") return `${tool} (${record[field]})`;
  }
  // Only extract literal JSON strings; never execute or guess dynamic JavaScript.
  if (typeof input === "string" && /(?:^|\.)exec$/.test(tool)) {
    const commands = [...input.matchAll(/\b(?:cmd|command)\s*:\s*("(?:[^"\\]|\\.)*")/g)].flatMap(
      (match) => {
        try {
          return [JSON.parse(match[1]!) as string];
        } catch {
          return [];
        }
      },
    );
    if (commands.length) return commands.join("; ");
  }
  return tool;
}
