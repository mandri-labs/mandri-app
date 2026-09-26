import { createStore } from "zustand/vanilla";
import type { AgentView } from "@/daemon/types/agents";
import type { ServerMessage } from "@/daemon/types/ws";
import { daemonIdentity } from "@/daemon/identity";
import { daemonErrorKey, DaemonError } from "@/daemon/errors";
import { getDaemonSocket } from "@/app/connection";

interface AgentsState {
  agents: Record<string, AgentView>;
  parentCapabilities: Record<string, { create: boolean }>;
  classifiedSessionIds: string[];
  loaded: boolean;
  error: string | null;
  drafts: Record<string, string>;
}

const initial: AgentsState = {
  agents: {},
  parentCapabilities: {},
  classifiedSessionIds: [],
  loaded: false,
  error: null,
  drafts: {},
};
export const agentsStore = createStore<AgentsState>(() => initial);
let pending: Promise<void> | undefined;
let revision = 0;
let refreshAfterPending = false;
const agentRevisions = new Map<string, number>();

daemonIdentity.subscribe(() => {
  pending = undefined;
  refreshAfterPending = false;
  revision = 0;
  agentRevisions.clear();
  agentsStore.setState(initial);
});

export function upsertAgent(agent: AgentView): void {
  revision += 1;
  agentRevisions.set(agent.id, revision);
  agentsStore.setState((state) => ({ agents: { ...state.agents, [agent.id]: agent } }));
}

export function setAgentDraft(id: string, draft: string): void {
  agentsStore.setState((state) => ({ drafts: { ...state.drafts, [id]: draft } }));
}

export function refreshAgents(): Promise<void> {
  if (pending) return pending;
  const generation = daemonIdentity.getState().generation;
  const startedRevision = revision;
  const socket = getDaemonSocket();
  if (!socket) return Promise.resolve();
  const promise = socket
    .request("agent.list", {})
    .then((result) => {
      if (generation !== daemonIdentity.getState().generation) return;
      if (!Array.isArray(result.agents))
        throw new DaemonError({ code: "unknown", message: "Invalid agent list" });
      const listed = Object.fromEntries(result.agents.map((agent) => [agent.id, agent]));
      // A live event received during the list request is newer than that response.
      const agents = { ...listed };
      for (const [id, changedAt] of agentRevisions) {
        if (changedAt <= startedRevision) continue;
        const current = agentsStore.getState().agents[id];
        if (current)
          agents[id] = {
            ...current,
            capabilities: listed[id]?.capabilities ?? current.capabilities,
          };
      }
      agentsStore.setState({
        agents,
        parentCapabilities: result.parent_capabilities,
        classifiedSessionIds: result.classified_session_ids ?? [],
        loaded: true,
        error: null,
      });
    })
    .catch((error: unknown) => {
      if (generation === daemonIdentity.getState().generation)
        agentsStore.setState({ error: daemonErrorKey(error) });
    })
    .finally(() => {
      if (pending !== promise) return;
      pending = undefined;
      if (refreshAfterPending) {
        refreshAfterPending = false;
        void refreshAgents();
      }
    });
  pending = promise;
  return promise;
}

export function ingestAgentFrame(frame: ServerMessage): void {
  if (!("topic" in frame) || frame.topic !== "agents.all") return;
  if (
    "raw" in frame &&
    typeof frame.raw === "object" &&
    frame.raw !== null &&
    "agent" in frame.raw
  ) {
    const agent = frame.raw.agent as AgentView;
    if (typeof agent?.id === "string")
      upsertAgent({
        ...agent,
        capabilities: agentsStore.getState().agents[agent.id]?.capabilities ?? agent.capabilities,
      });
  }
  if (pending) refreshAfterPending = true;
  else void refreshAgents();
}
