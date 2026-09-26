import { setSessionEffort } from "@/daemon/rest/sessions";
import { sessionsStore } from "@/stores/sessions";
import { queueSessionModelChange } from "./sessionModelQueue";
import { daemonIdentity } from "@/daemon/identity";

export async function swapSessionEffort(sessionId: string, effort: string | null): Promise<void> {
  return queueSessionModelChange(sessionId, async () => {
    const generation = daemonIdentity.getState().generation;
    const previous = sessionsStore.getState().sessions[sessionId]?.reasoningEffort ?? null;
    sessionsStore.getState().applySessionPatch(sessionId, { reasoningEffort: effort });
    try {
      await setSessionEffort(sessionId, effort);
    } catch (error) {
      if (generation === daemonIdentity.getState().generation) {
        sessionsStore.getState().applySessionPatch(sessionId, { reasoningEffort: previous });
      }
      throw error;
    }
  });
}
