import { getDaemonSocket } from "@/app/connection";
import { daemonIdentity } from "@/daemon/identity";
import { DaemonError } from "@/daemon/errors";
import type { HarnessKind } from "@/daemon/types/ws";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";

let feed: SessionFeedService | undefined;

export function getAgentFeed(): SessionFeedService {
  return (feed ??= new SessionFeedService({
    getSocket: () => null,
    fetchHistoryPage: async (viewId, cursor, limit) => {
      const socket = getDaemonSocket();
      if (!socket)
        throw new DaemonError({ code: "service_unavailable", message: "Socket unavailable" });
      return socket.request("agent.history", {
        agent_id: viewId.slice("agent:".length),
        cursor,
        limit,
      });
    },
  }));
}

type FeedReason = "view" | "pane";
const subscriptions = new Map<string, { reasons: Set<FeedReason>; dispose: () => void }>();

export function acquireAgentFeed(id: string, harness: HarnessKind, reason: FeedReason): void {
  const existing = subscriptions.get(id);
  if (existing) {
    existing.reasons.add(reason);
    return;
  }
  const viewId = `agent:${id}`;
  const agentFeed = getAgentFeed();
  agentFeed.ensureSession(viewId, harness);
  const socket = getDaemonSocket();
  const topic = `agent.${id}` as const;
  const unsubscribe = socket?.onFrame?.((frame) => {
    if ("topic" in frame && frame.topic === topic) {
      agentFeed.ingestSessionFrame(viewId, harness, { ...frame, topic: `session.${viewId}` });
    }
  });
  socket?.subscribe(topic);
  subscriptions.set(id, {
    reasons: new Set([reason]),
    dispose: () => {
      unsubscribe?.();
      socket?.unsubscribe(topic);
      agentFeed.closeSession(viewId);
    },
  });
}

export function releaseAgentFeed(id: string, reason: FeedReason): void {
  const subscription = subscriptions.get(id);
  if (!subscription) return;
  subscription.reasons.delete(reason);
  if (subscription.reasons.size) return;
  subscriptions.delete(id);
  subscription.dispose();
}

daemonIdentity.subscribe(() => {
  for (const subscription of subscriptions.values()) subscription.dispose();
  subscriptions.clear();
});
