import type { CommandInvocation } from "@/daemon/types/commands";
import type { HarnessKind } from "@/daemon/types/ws";

export type CommandPlacement = "all" | "composer" | "transcript";

export function commandsForPlacement(records: CommandInvocation[], placement: CommandPlacement, harness?: HarnessKind): CommandInvocation[] {
  if (placement === "all") return records;
  const category = (record: CommandInvocation) => {
    const name = record.command.name.replace(/^\//, "").toLowerCase();
    if (record.command.kind === "skill") return undefined;
    return name === "goal" || (harness === "opencode" && name === "review") ? name : undefined;
  };
  const latest = new Map<string, CommandInvocation>();
  for (const record of records) {
    const name = category(record);
    if (name) latest.set(name, record);
  }
  return records.filter((record) => {
    const name = category(record);
    return placement === "composer" ? name !== undefined && latest.get(name) === record : name === undefined;
  });
}
