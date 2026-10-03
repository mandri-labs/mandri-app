import { ConversationIndicator } from "@/features/sessions/ConversationIndicator";
import { ConversationReadMenu } from "@/features/sessions/ConversationReadMenu";
import { useTranslation } from "react-i18next";
import type { AgentView } from "@/daemon/types/agents";
import { navigate } from "@/app/useHashRoute";
import "./agents.css";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { flattenAgentTree } from "./agentTree";

export function AgentSidebar({ agents, activeId }: { agents: AgentView[]; activeId?: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (activeId) setExpanded(true);
  }, [activeId]);
  const rows = flattenAgentTree(agents);
  if (agents.length === 0) return null;
  return (
    <div className="shell-agent-group">
      <button
        type="button"
        className="shell-agent-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight
          size={12}
          className={expanded ? "shell-agent-chevron--expanded" : undefined}
        />
        {t("core.agents.group", { count: agents.length })}
      </button>
      {expanded &&
        rows.map(({ agent, depth }) => (
          <div key={agent.id} className={`shell-session-container${activeId === agent.id ? " shell-session-container--active" : ""}`}><button
            type="button"
            title={agent.title}
            className={`shell-session-row shell-agent-row${activeId === agent.id ? " shell-session-row--active" : ""}`}
            style={{ paddingLeft: 22 + Math.min(depth, 8) * 12 }}
            aria-label={`${agent.title} — ${t(`core.agents.state.${agent.state}`)}`}
            aria-current={activeId === agent.id ? "page" : undefined}
            onClick={() => navigate({ name: "agent", id: agent.id })}
          >
            <span className="shell-session-icon-slot" aria-hidden="true" />
            <span className="shell-session-title">{agent.title}</span>
            <span className="shell-session-status-slot">
              <ConversationIndicator
                target={agent.session_id ? `session:${agent.session_id}` : `agent:${agent.id}`}
              />
            </span>
          </button>
          <ConversationReadMenu target={agent.session_id ? `session:${agent.session_id}` : `agent:${agent.id}`} />
          </div>
        ))}
    </div>
  );
}
