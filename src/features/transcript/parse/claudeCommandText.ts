import type { TranscriptNode } from "./types";

const invocation =
  /^\s*(?:<command-message>[^<]*<\/command-message>\s*)?<command-name>\s*(\/[^\s<>]+)\s*<\/command-name>\s*(?:<command-message>[^<]*<\/command-message>\s*)?(?:<command-args>([\s\S]*)<\/command-args>\s*)?$/;
const output = /^\s*<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>\s*$/;

export function claudeCommandText(text: string): TranscriptNode | undefined {
  const command = invocation.exec(text);
  if (command) {
    const args = command[2]?.trim();
    return { kind: "user", text: `${command[1]}${args ? ` ${args}` : ""}` };
  }
  const result = output.exec(text);
  if (result)
    return {
      kind: "system",
      level: result[1] === "stderr" ? "error" : "info",
      text: result[2]?.trim() ?? "",
    };
  return undefined;
}
