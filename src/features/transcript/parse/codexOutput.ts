import { asRecord } from "./shared";

function decode(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function structuredText(value: unknown, depth: number): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 12) return JSON.stringify(value, null, 2);
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const block = asRecord(entry);
        return structuredText(block?.["type"] === "text" ? block["text"] : entry, depth + 1);
      })
      .join("\n");
  }
  return Object.entries(value)
    .map(([key, entry]) => {
      const text = structuredText(entry, depth + 1);
      return text.includes("\n") || (entry !== null && typeof entry === "object")
        ? `${key}:\n${text
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n")}`
        : `${key}: ${text}`;
    })
    .join("\n");
}

export function codexOutputText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return structuredText(value, 0);
  const decoded = decode(value);
  if (decoded !== value) return structuredText(decoded, 0);

  const envelope = /^(Script (?:completed|running)[\s\S]*?\nOutput:\s*\r?\n)([\s\S]*)$/.exec(value);
  if (!envelope) return value;
  const body = envelope[2] ?? "";
  const parsed = decode(body);
  if (parsed !== body) return `${envelope[1]}${structuredText(parsed, 0)}`;
  return `${envelope[1]}${body
    .split("\n")
    .map((line) => {
      const record = asRecord(decode(line));
      return record ? structuredText(record, 0) : line;
    })
    .join("\n")}`;
}
