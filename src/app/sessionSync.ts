import { getDaemonSocket } from "@/app/connection";
import { sessionsStore } from "@/stores/sessions";
import { createDebugLogger } from "@/lib/debug";

const log = createDebugLogger("sessionSync");
let generation = 0;

export function invalidateSessionMetadata(): void {
  generation += 1;
  sessionsStore.getState().setSyncState("idle");
}

export async function refreshSessionMetadata(): Promise<void> {
  const request = ++generation;
  sessionsStore.getState().setSyncState("syncing");
  try {
    const socket = getDaemonSocket();
    if (socket === null) return;
    const { sessions: rows } = await socket.request("session.list", {});
    if (request !== generation) return;
    const current = sessionsStore.getState().sessions;
    sessionsStore.getState().upsertFromRest(rows.map((row) => ({
      ...row,
      state: current[row.id]?.state ?? row.state,
      activity: current[row.id]?.activity ?? row.activity,
      last_activity_at: current[row.id]?.lastActivityAt ?? row.last_activity_at,
    })));
  } catch (error) {
    log.warn("session metadata refresh failed", { message: String(error) });
  } finally {
    if (request === generation) sessionsStore.getState().setSyncState("idle");
  }
}
