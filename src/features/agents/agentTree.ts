import type { AgentView } from "@/daemon/types/agents";

export function flattenAgentTree(agents: AgentView[]): { agent: AgentView; depth: number }[] {
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
  return rows;
}
