import { navigate } from "@/app/useHashRoute";
import { DaemonError } from "@/daemon/errors";
import { daemonIdentity } from "@/daemon/identity";
import type { CommandInvocation, NativeCommand } from "@/daemon/types/commands";
import type { HarnessKind } from "@/daemon/types/ws";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { commandTransport, type CommandTransport } from "@/features/commands/service";
import { rememberCommand } from "@/features/commands/store";
import { sessionsStore } from "@/stores/sessions";
import { startNewSession, type SessionStartInput } from "./lifecycle";

export async function startCommandSession({ input, command, args, invocationId, acceptResult, onCreated, transport = commandTransport }: {
  input: SessionStartInput;
  command: NativeCommand;
  args: string;
  invocationId: string;
  acceptResult: () => boolean;
  onCreated: (sessionId: string) => void;
  transport?: CommandTransport;
}): Promise<CommandInvocation> {
  const generation = daemonIdentity.getState().generation;
  const current = () => acceptResult() && generation === daemonIdentity.getState().generation;
  const created = await startNewSession(input, current);
  if (!current()) throw new Error("Session startup cancelled");
  sessionFeed.ensureSession(created.id, created.harness as HarnessKind, { newSession: true });
  sessionFeed.subscribeSession(created.id);
  onCreated(created.id);
  let record: CommandInvocation;
  try {
    record = await transport.invoke(created.id, invocationId, command.id, args);
  } catch (error) {
    record = {
      invocation_id: invocationId,
      session_id: created.id,
      command,
      state: error instanceof DaemonError && error.code === "delivery_unknown" ? "unknown" : "failed",
      error: error instanceof Error ? error.message : String(error),
      cancellable: false,
    };
    if (current() && record.state === "failed") {
      sessionsStore.getState().setDraft(created.id, `/${command.name.replace(/^\//, "")}${args ? ` ${args}` : ""}`);
    }
  }
  if (current()) {
    rememberCommand(record);
    navigate({ name: "session", id: created.id });
  }
  return record;
}
