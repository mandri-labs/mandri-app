import type { HarnessKind } from "@/daemon/types/ws";
import { agentsStore } from "@/stores/agents";
import { paneKey, panesStore, type PaneTarget } from "@/stores/panes";
import { sessionsStore } from "@/stores/sessions";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { acquireAgentFeed, releaseAgentFeed } from "@/features/agents/agentFeed";

export function rootSessionIds(): string[] {
  const { agents, loaded, classifiedSessionIds } = agentsStore.getState();
  if (!loaded) return [];
  const linked = new Set(Object.values(agents).map((agent) => agent.session_id));
  const classified = new Set(classifiedSessionIds);
  const { sessions, order } = sessionsStore.getState();
  return order.filter(
    (id) => !linked.has(id) && classified.has(id) && sessions[id] && !sessions[id]?.deleted,
  );
}

export function openSessionPane(id: string, harness: HarnessKind): boolean {
  if (!panesStore.getState().openTarget({ kind: "session", id })) return false;
  sessionFeed.ensureSession(id, harness);
  keepAlive.acquire(id, "pane");
  return true;
}

export function openTargetPane(target: PaneTarget): boolean {
  if (target.kind === "session") {
    const session = sessionsStore.getState().sessions[target.id];
    return !!session && openSessionPane(target.id, session.harness);
  }
  const agent = agentsStore.getState().agents[target.id];
  if (!agent || !panesStore.getState().openTarget(target)) return false;
  acquireAgentFeed(agent.id, agent.harness, "pane");
  return true;
}

export function retainPaneTarget(target: PaneTarget): void {
  if (target.kind === "agent") {
    const agent = agentsStore.getState().agents[target.id];
    if (agent) acquireAgentFeed(agent.id, agent.harness, "pane");
  } else {
    const session = sessionsStore.getState().sessions[target.id];
    if (session) {
      sessionFeed.ensureSession(session.id, session.harness);
      keepAlive.acquire(session.id, "pane");
    }
  }
}

export function closeSessionPane(key: string): void {
  const pane = panesStore.getState().panes.find((item) => item.sessionId === key);
  panesStore.getState().closePane(key);
  if (pane?.target.kind === "agent") releaseAgentFeed(pane.target.id, "pane");
  else {
    keepAlive.release(key, "pane");
    if (!keepAlive.isHeld(key)) sessionFeed.closeSession(key);
  }
}

// Transfer the focused transcript before its panel releases the last subscription.
export function retainSingleView(target: PaneTarget): void {
  if (target.kind === "agent") {
    const agent = agentsStore.getState().agents[target.id];
    if (agent) acquireAgentFeed(agent.id, agent.harness, "view");
  } else {
    const session = sessionsStore.getState().sessions[target.id];
    if (session) {
      sessionFeed.ensureSession(session.id, session.harness);
      keepAlive.acquire(session.id, "session");
    }
  }
}

export function enterSplitMode(target?: PaneTarget): void {
  if (target) openTargetPane(target);
  if (panesStore.getState().panes.length < 2) {
    const familyId =
      target?.kind === "agent"
        ? agentsStore.getState().agents[target.id]?.parent_session_id
        : target?.id;
    const child = Object.values(agentsStore.getState().agents).find(
      (agent) =>
        agent.parent_session_id === familyId &&
        paneKey({ kind: "agent", id: agent.id }) !== (target && paneKey(target)),
    );
    if (child) openTargetPane({ kind: "agent", id: child.id });
    else {
      const { sessions } = sessionsStore.getState();
      const next = rootSessionIds()
        .filter((id) => !panesStore.getState().panes.some((pane) => pane.sessionId === id))
        .sort((a, b) => (sessions[b]?.lastActivityAt ?? 0) - (sessions[a]?.lastActivityAt ?? 0))[0];
      if (next) openTargetPane({ kind: "session", id: next });
    }
  }
  if (target) panesStore.getState().focusPane(paneKey(target));
}
