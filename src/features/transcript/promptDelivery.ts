import { daemonIdentity } from "@/daemon/identity";
import { DaemonError } from "@/daemon/errors";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { filesFor, persistFiles } from "./attachments";

export function deliveryUncertain(error: unknown): boolean {
  return (
    !(error instanceof DaemonError) ||
    [
      "composer_storage_unavailable",
      "delivery_unknown",
      "internal_error",
      "control_delivery_failed",
      "unknown",
    ].includes(error.code)
  );
}

export function markDelivery(
  sessionId: string,
  key: string,
  state: "preparing" | "sending" | "accepted" | "unknown" | "not_sent",
): void {
  if (!transcriptStore.getState().setDeliveryState(sessionId, key, state)) {
    throw new DaemonError({
      code: "composer_storage_unavailable",
      message: "Unable to save delivery state",
    });
  }
}

export async function restoreDelivery(sessionId: string, key: string): Promise<boolean> {
  const entry = transcriptStore
    .getState()
    .transcripts[sessionId]?.localUsers?.find((item) => item.node.key === key);
  if (!entry) return true;
  const generation = daemonIdentity.getState().generation;
  const delivery = entry.delivery;
  if (delivery?.filesKey) {
    const retained = filesFor(delivery.filesKey);
    const current = filesFor(sessionId);
    const keys = new Set(current.map((item) => item.key));
    if (
      !(await persistFiles(sessionId, [
        ...current,
        ...retained.filter((item) => !keys.has(item.key)),
      ]))
    )
      return false;
  }
  if (generation !== daemonIdentity.getState().generation) return false;
  const current = sessionsStore.getState().drafts[sessionId];
  const content = delivery?.content ?? entry.node.text;
  if (
    !sessionsStore
      .getState()
      .setDraft(sessionId, current ? `${content}\n\n${current}` : content, true)
  )
    return false;
  transcriptStore.getState().removePendingUser(sessionId, key);
  return true;
}
