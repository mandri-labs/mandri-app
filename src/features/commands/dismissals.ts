import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import type { CommandInvocation } from "@/daemon/types/commands";

export const commandDismissals = createStore(() => ({ hidden: {} as Record<string, boolean> }));
export const commandDismissalKey = (record: CommandInvocation) => `${record.session_id}:${record.invocation_id}`;

export function canDismissCommand(record: CommandInvocation, sessionState?: string): boolean {
  return ["succeeded", "failed", "interrupted"].includes(record.state) || sessionState === "stopped";
}

export function dismissCommand(record: CommandInvocation, sessionState?: string): void {
  if (!canDismissCommand(record, sessionState)) return;
  commandDismissals.setState((state) => ({ hidden: { ...state.hidden, [commandDismissalKey(record)]: true } }));
}

daemonIdentity.subscribe((next, previous) => {
  if (next.generation !== previous.generation) commandDismissals.setState({ hidden: {} });
});
