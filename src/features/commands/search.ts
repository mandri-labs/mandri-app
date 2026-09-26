import type { NativeCommand } from "@/daemon/types/commands";
import { fuzzyMatch } from "@/lib/fuzzy";

export function commandInput(text: string): { query: string; arguments: string } | null {
  const match = /^\/([^\s]*)(?:\s([\s\S]*))?$/.exec(text);
  return match ? { query: match[1] ?? "", arguments: match[2] ?? "" } : null;
}

export function searchCommands(commands: NativeCommand[], query: string): NativeCommand[] {
  return [...new Map(commands.map((command) => [command.id, command])).values()]
    .map((command) => ({ command, score: query ? Math.max(...[command.name, ...command.aliases]
      .map((name) => fuzzyMatch(query, name.replace(/^\//, ""))?.score ?? -Infinity)) : 0 }))
    .filter(({ score }) => score !== -Infinity)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map(({ command }) => command);
}
