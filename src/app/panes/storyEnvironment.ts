import { dispatchFrame } from "@/app/framePipeline";
import { installReplaySocket } from "@/storybook/replayConnection";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { DaemonError } from "@/daemon/errors";
import type { ActionResultMap, RequestAction, ServerMessage } from "@/daemon/types/ws";
import type { RequestParamsOf } from "@/daemon/ws/protocol";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { agentsStore, upsertAgent } from "@/stores/agents";
import { approvalsStore } from "@/stores/approvals";
import { connectionStore } from "@/stores/connection";
import { panesStore } from "@/stores/panes";
import { teamSessions, teamAgents, storyHistory } from "./storyData";

export function installTeamStory(waiting: boolean, failed = false): () => void {
  const fetchBefore = window.fetch;
  const connectionBefore = connectionStore.getState();
  const sessionsBefore = sessionsStore.getState();
  const agentsBefore = agentsStore.getState();
  const hashBefore = window.location.hash;
  const sessions = teamSessions.map((session) => ({ ...session }));
  const agents = teamAgents.map((agent) => ({ ...agent, capabilities: { ...agent.capabilities } }));
  const history = new Map(
    [...sessions, ...agents].map((row) => [row.id, storyHistory(row.harness, row.id)]),
  );
  if (failed) {
    const review = agents.find((agent) => agent.id === "review")!;
    review.state = "failed";
    history.set(
      "team",
      storyHistory("claude", "team", [
        ["user", "Prepare the authentication update and review it before release."],
        [
          "assistant",
          "Implementation is underway. The security review failed before completion because its test workspace was unavailable.\n\nRelease is blocked until the workspace is restored and a new review is complete.",
        ],
      ]),
    );
    history.set(
      review.id,
      storyHistory(review.harness, review.id, [
        ["user", "Review the security boundary around refresh-token rotation."],
        [
          "assistant",
          "The review stopped before completion because the test workspace was unavailable.\n\nThe implementation has not been approved. Restore the workspace and start a new review before release.",
        ],
      ]),
    );
  }
  const listeners = new Set<(frame: ServerMessage) => void>();
  let seq = 0;
  const changed = (kind: "agent" | "session", id: string) => {
    const frame = {
      topic: `${kind}.${id}`,
      seq: ++seq,
      source: "mandri",
      ts: Date.now(),
      raw: { type: "history_changed" },
    } as ServerMessage;
    dispatchFrame(frame);
    for (const listener of listeners) listener(frame);
  };
  const restoreSocket = installReplaySocket({
    request: async <A extends RequestAction>(
      action: A,
      params: RequestParamsOf<A>,
    ): Promise<ActionResultMap[A]> => {
      const values = params as Record<string, unknown>;
      const id = String(values.agent_id ?? values.session_id ?? "");
      let result: unknown;
      switch (action) {
        case "session.history":
        case "agent.history":
          result = {
            entries: values.cursor ? [] : (history.get(id) ?? []),
            next_cursor: null,
            has_more: false,
          };
          break;
        case "agent.list":
          result = {
            agents,
            parent_capabilities: { team: { create: true } },
            classified_session_ids: sessions.map((session) => session.id),
          };
          break;
        case "session.list":
          result = { sessions: [] };
          break;
        case "command.list":
          result = { invocations: [] };
          break;
        case "command.catalogs":
          result = { default_cwd: "/workspace/atlas", catalogs: [] };
          break;
        case "command.catalog":
          result = {
            ...values,
            cwd: values.cwd ?? "/workspace/atlas",
            profile_id: null,
            execution_backend: "host",
            privacy_mode: "none",
            state: "ready",
            commands: [],
            reason: null,
          };
          break;
        case "agent.message":
        case "session.prompt": {
          const row = [...agents, ...sessions].find((item) => item.id === id);
          if (!row)
            throw new DaemonError({
              code: "service_unavailable",
              message: "Unknown story conversation",
            });
          const content = String(values.content ?? "");
          history.set(id, [
            ...(history.get(id) ?? []),
            ...storyHistory(row.harness, `${id}-${seq}`, [
              ["user", content],
              [
                "assistant",
                "The instruction is recorded in this local preview. The live application sends it through this conversation’s own control channel.",
              ],
            ]),
          ]);
          changed(action === "agent.message" ? "agent" : "session", id);
          result =
            action === "agent.message"
              ? { agent_id: id, accepted: true }
              : { state: "queued", code: null };
          break;
        }
        case "agent.stop": {
          const agent = agents.find((item) => item.id === id);
          if (agent) {
            agent.state = "stopped";
            agent.capabilities.stop = false;
            upsertAgent(agent);
          }
          result = { agent_id: id, stopped: true };
          break;
        }
        case "approval.answer":
          result = { approval_id: values.approval_id, status: "answered" };
          break;
        default:
          throw new DaemonError({
            code: "agent_unsupported",
            message: "This action is unavailable in the offline preview",
          });
      }
      return result as ActionResultMap[A];
    },
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    onFrame: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (!url.pathname.startsWith("/v1/")) return fetchBefore(input, init);
    const body = url.pathname.endsWith("/availability")
      ? {
          owner: "mandri",
          activity: "idle",
          can_resume: false,
          can_release: true,
          can_restore: false,
          reason: null,
        }
      : [];
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  };
  panesStore.getState().closeAll();
  transcriptStore.getState().resetTranscripts();
  approvalsStore.getState().reset();
  sessionsStore.setState({
    sessions: Object.fromEntries(sessions.map((session) => [session.id, session])),
    order: sessions.map((session) => session.id),
    filters: {},
    syncState: "idle",
  });
  agentsStore.setState({
    agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    loaded: true,
    classifiedSessionIds: sessions.map((session) => session.id),
    parentCapabilities: { team: { create: true } },
    error: null,
    drafts: {},
  });
  connectionStore.setState({ status: "online" });
  if (waiting)
    approvalsStore
      .getState()
      .ingestFrame({
        type: "approval.pending",
        topic: "agent.migration",
        source: "opencode",
        seq: 1,
        ts: Date.now(),
        approval_id: "migration-smoke",
        deadline: Date.now() + 3600000,
        status: "pending",
        raw: {
          type: "permission.asked",
          properties: { permission: "bash", patterns: ["npm run test:migration"] },
        },
      });
  return () => {
    for (const session of sessions) {
      keepAlive.forget(session.id);
      sessionFeed.closeSession(session.id);
    }
    panesStore.getState().closeAll();
    approvalsStore.getState().reset();
    restoreSocket();
    listeners.clear();
    window.fetch = fetchBefore;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hashBefore}`,
    );
    connectionStore.setState(connectionBefore);
    sessionsStore.setState(sessionsBefore);
    agentsStore.setState(agentsBefore);
  };
}
