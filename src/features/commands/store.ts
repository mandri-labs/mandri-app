import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import type { CommandInvocation } from "@/daemon/types/commands";

export const commandsStore = createStore<{ sessions: Record<string, CommandInvocation[]> }>(() => ({ sessions: {} }));
export const EMPTY_COMMANDS: CommandInvocation[] = [];

export function rememberCommand(record: CommandInvocation): void {
  commandsStore.setState((state) => ({ sessions: { ...state.sessions, [record.session_id]: [
    ...(state.sessions[record.session_id] ?? []).map((row) => row.invocation_id === record.invocation_id ? record : row),
    ...((state.sessions[record.session_id] ?? []).some((row) => row.invocation_id === record.invocation_id) ? [] : [record]),
  ] } }));
}

export function reconcileCommands(sessionId: string, records: CommandInvocation[]): void {
  commandsStore.setState((state) => {
    const previous = state.sessions[sessionId] ?? [];
    const missing = previous.filter((row) => !records.some((item) => item.invocation_id === row.invocation_id))
      .map((row): CommandInvocation => row.state === "running" ? { ...row, state: "unknown", cancellable: false } : row);
    return { sessions: { ...state.sessions, [sessionId]: [...missing, ...records] } };
  });
}

daemonIdentity.subscribe((next, previous) => {
  if (next.generation !== previous.generation) commandsStore.setState({ sessions: {} });
});
