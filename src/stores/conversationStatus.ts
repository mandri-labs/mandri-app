import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import type { ConversationStatus } from "@/daemon/types/conversationStatus";
import type { ServerMessage } from "@/daemon/types/ws";

export const conversationStatusStore = createStore(() => ({
  statuses: {} as Record<string, ConversationStatus>,
}));

daemonIdentity.subscribe(() => conversationStatusStore.setState({ statuses: {} }));

function statusFromWire(value: unknown): ConversationStatus | undefined {
  if (!value || typeof value !== "object") return;
  const status = value as ConversationStatus;
  if (typeof status.target !== "string" || !/^(session|agent):.+$/.test(status.target) ||
    !["idle", "working", "waiting", "unknown"].includes(status.work_state) ||
    ![status.revision, status.completion_revision, status.read_revision].every(
      (revision) => Number.isSafeInteger(revision) && revision >= 0,
    ) || status.read_revision > status.completion_revision) return;
  return status;
}

export function ingestConversationStatus(value: unknown): void {
  const status = statusFromWire(value);
  if (!status) return;
  conversationStatusStore.setState((state) => {
    const previous = state.statuses[status.target];
    if (previous && previous.revision >= status.revision) return state;
    return { statuses: { ...state.statuses, [status.target]: status } };
  });
}

export function ingestConversationFrame(frame: ServerMessage): void {
  if ("type" in frame && frame.type === "snapshot") {
    for (const status of frame.statuses ?? []) ingestConversationStatus(status);
  } else if ("type" in frame && frame.type === "conversation_status") {
    ingestConversationStatus(frame.status);
  } else if ("topic" in frame && frame.topic === "conversations.all" && "raw" in frame) {
    const payload = frame.raw;
    if (payload && typeof payload === "object" && "type" in payload &&
      payload.type === "conversation_status" && "status" in payload) {
      ingestConversationStatus(payload.status);
    }
  }
}
