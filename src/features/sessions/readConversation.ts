import { getDaemonSocket } from "@/app/connection";
import { daemonIdentity } from "@/daemon/identity";
import type { ConversationTarget } from "@/daemon/types/conversationStatus";
import { ingestConversationStatus } from "@/stores/conversationStatus";

const pending = new Map<string, Promise<void>>();

export function readConversation(
  target: ConversationTarget,
  throughRevision: number,
  completionKey: string,
): Promise<void> {
  const generation = daemonIdentity.getState().generation;
  const key = `${generation}:${target}:${throughRevision}:${completionKey}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const socket = getDaemonSocket();
  if (!socket) return Promise.reject(new Error("Connection unavailable"));
  const request = socket
    .request("conversation.read", {
      target,
      through_revision: throughRevision,
      completion_key: completionKey,
    })
    .then((status) => {
      if (generation === daemonIdentity.getState().generation) ingestConversationStatus(status);
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
