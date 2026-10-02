import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Square } from "lucide-react";
import { useStore } from "@/app/useStore";
import { getDaemonSocket } from "@/app/connection";
import { daemonErrorKey, DaemonError } from "@/daemon/errors";
import { acquireAgentFeed, releaseAgentFeed, getAgentFeed } from "./agentFeed";
import { agentsStore, refreshAgents, upsertAgent, setAgentDraft } from "@/stores/agents";
import { transcriptStore } from "@/stores/sessions";
import { Transcript } from "@/features/transcript/Transcript";
import { connectionStore } from "@/stores/connection";
import { SessionApprovals } from "@/features/approvals/SessionApprovals";
import { daemonIdentity } from "@/daemon/identity";
import "./agents.css";

export function AgentView({
  agentId,
  feedReason = "view",
}: {
  agentId: string;
  feedReason?: "view" | "pane";
}) {
  const agentFeed = getAgentFeed();
  const { t } = useTranslation();
  const agent = useStore(agentsStore, (state) => state.agents[agentId]);
  const loadingError = useStore(agentsStore, (state) => state.error);
  const status = useStore(connectionStore, (state) => state.status);
  const draft = useStore(agentsStore, (state) => state.drafts[agentId] ?? "");
  const setDraft = (value: string) => setAgentDraft(agentId, value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewId = `agent:${agentId}`;
  const pendingCount = useStore(
    transcriptStore,
    (state) => state.transcripts[viewId]?.pendingUsers?.length ?? 0,
  );
  useEffect(() => {
    if (pendingCount === 0)
      setError((current) => (current === "error.delivery_unknown" ? null : current));
  }, [pendingCount]);
  const harness = agent?.harness;
  const generation = useStore(daemonIdentity, (state) => state.generation);
  useEffect(() => {
    if (!harness) return;
    acquireAgentFeed(agentId, harness, feedReason);
    return () => releaseAgentFeed(agentId, feedReason);
  }, [agentId, harness, feedReason, generation]);

  if (!agent)
    return (
      <div className="agents-empty" role="status">
        {t(loadingError ?? "core.agents.loading")}
        <button type="button" className="providers-button" onClick={() => void refreshAgents()}>
          {t("core.actions.retry")}
        </button>
      </div>
    );

  const send = async () => {
    const generation = daemonIdentity.getState().generation;
    const content = draft.trim();
    const socket = getDaemonSocket();
    if (!socket || !content || busy || !agent.capabilities.message || status !== "online") return;
    setBusy(true);
    setError(null);
    setDraft("");
    const key = transcriptStore.getState().addPendingUser(viewId, content);
    try {
      await socket.request("agent.message", { agent_id: agent.id, content });
      if (generation !== daemonIdentity.getState().generation) return;
      await agentFeed.loadHistory(viewId, { refresh: true, preserveOlder: true });
      if (generation !== daemonIdentity.getState().generation) return;
      void refreshAgents();
    } catch (caught) {
      if (generation !== daemonIdentity.getState().generation) return;
      if (!(caught instanceof DaemonError && caught.code === "delivery_unknown")) {
        transcriptStore.getState().removePendingUser(viewId, key);
        const current = agentsStore.getState().drafts[agentId];
        setDraft(current ? `${content}\n\n${current}` : content);
      }
      setError(daemonErrorKey(caught));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    const generation = daemonIdentity.getState().generation;
    const socket = getDaemonSocket();
    if (!socket || busy || !agent.capabilities.stop) return;
    setBusy(true);
    setError(null);
    try {
      const result = await socket.request("agent.stop", { agent_id: agent.id });
      if (generation !== daemonIdentity.getState().generation) return;
      if (result.stopped) upsertAgent({ ...agent, state: "stopped" });
      await refreshAgents();
    } catch (caught) {
      if (generation !== daemonIdentity.getState().generation) return;
      setError(daemonErrorKey(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="session-view">
      <div className="session-view-column">
        <div className="agents-toolbar">
          <span className={`agent-status agent-status--${agent.state}`}>
            {t(`core.agents.state.${agent.state}`)}
          </span>
          {agent.capabilities.stop && (
            <button
              className="agents-stop"
              disabled={busy || status !== "online"}
              onClick={() => void stop()}
            >
              <Square size={12} />
              {t("core.agents.stop")}
            </button>
          )}
        </div>
        <Transcript sessionId={viewId} harness={agent.harness} feed={agentFeed} />
        <SessionApprovals sessionId={agent.parent_session_id} agentId={agent.id} />
        <div className="session-view-composer">
          {error && (
            <div className="composer-error" role="alert">
              {t(error)}
            </div>
          )}
          {agent.capabilities.message ? (
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                className="composer-input"
                aria-label={t("core.agents.message")}
                placeholder={t("core.agents.message")}
                value={draft}
                rows={2}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-tools">
                <button
                  type="submit"
                  className="composer-send"
                  aria-label={t("core.transcript.send")}
                  disabled={busy || status !== "online" || !draft.trim()}
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </form>
          ) : (
            <p className="agents-readonly">{t("core.agents.readonly")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
