import { setSessionModel } from "@/daemon/rest/sessions";
import type { components } from "@/daemon/types/rest.gen";
import { sessionModelRef } from "@/daemon/modelSelection";
import { permitsModel, policyFromWire } from "@/daemon/protection";
import { DaemonError } from "@/daemon/errors";
import { sessionsStore } from "@/stores/sessions";
import { queueSessionModelChange } from "./sessionModelQueue";

type SessionOut = components["schemas"]["SessionOut"];

export async function swapSessionModel(sessionId: string, model: string): Promise<SessionOut> {
  return queueSessionModelChange(sessionId, async () => {
    if (!permitsModel(model, sessionsStore.getState().sessions[sessionId] ?? {})) {
      throw new DaemonError({
        code: "privacy_native_unsupported",
        message: "This session requires a gateway model",
      });
    }
    const updated = await setSessionModel(sessionId, model);
    sessionsStore.getState().applySessionPatch(sessionId, {
      ...policyFromWire(updated, sessionsStore.getState().sessions[sessionId]),
      model: sessionModelRef(updated) ?? model,
      reasoningEffort: updated.reasoning_effort ?? null,
    });
    return updated;
  });
}
