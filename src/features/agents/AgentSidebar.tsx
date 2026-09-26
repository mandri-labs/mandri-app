import { useTranslation } from "react-i18next";
import type { AgentView } from "@/daemon/types/agents";
import { navigate } from "@/app/useHashRoute";
import "./agents.css";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

export function AgentSidebar({ agents, activeId }: { agents: AgentView[]; activeId?: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const ids = new Set(agents.map((agent) => agent.id));
  const visited = new Set<string>();
  const rows: { agent: AgentView; depth: number }[] = [];
  const visit = (agent: AgentView, depth: number) => {
    if (visited.has(agent.id)) return;
    visited.add(agent.id);
    rows.push({ agent, depth });
    for (const child of agents) if (child.parent_agent_id === agent.id) visit(child, depth + 1);
  };
  for (const agent of agents)
    if (!agent.parent_agent_id || !ids.has(agent.parent_agent_id)) visit(agent, 0);
  for (const agent of agents) visit(agent, 0);
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
          <button
            key={agent.id}
            type="button"
            title={agent.title}
            className={`shell-session-row shell-agent-row${activeId === agent.id ? " shell-session-row--active" : ""}`}
            style={{ paddingLeft: 22 + Math.min(depth, 8) * 12 }}
            aria-label={`${agent.title} — ${t(`core.agents.state.${agent.state}`)}`}
            aria-current={activeId === agent.id ? "page" : undefined}
            onClick={() => navigate({ name: "agent", id: agent.id })}
          >
            <span
              className={`shell-agent-state shell-agent-state--${agent.state}`}
              aria-hidden="true"
            />
            <span className="shell-session-title">{agent.title}</span>
          </button>
        ))}
    </div>
  );
}
