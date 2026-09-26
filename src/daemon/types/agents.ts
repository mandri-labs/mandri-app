import type { HarnessKind } from "./ws";

export interface AgentView {
  id: string;
  parent_session_id: string;
  parent_agent_id: string | null;
  session_id: string | null;
  native_id: string;
  harness: HarnessKind;
  title: string;
  state: "running" | "completed" | "failed" | "stopped" | "waiting" | "unknown";
  delegation_id: string | null;
  task_id?: string | null;
  capabilities: { message: boolean; stop: boolean };
  created_at: number;
  updated_at: number;
}

export interface AgentParams {
  "agent.list": { session_id?: string };
  "agent.history": { agent_id: string; cursor?: string | null; limit?: number };
  "agent.create": { session_id: string; content: string; title?: string };
  "agent.message": { agent_id: string; content: string };
  "agent.stop": { agent_id: string };
}

export interface AgentResults {
  "agent.list": {
    agents: AgentView[];
    parent_capabilities: Record<string, { create: boolean }>;
    classified_session_ids: string[];
  };
  "agent.history": { entries: string[]; next_cursor: string | null; has_more: boolean };
  "agent.create": { agent: AgentView };
  "agent.message": { agent_id: string; accepted: boolean };
  "agent.stop": { agent_id: string; stopped: boolean };
}

export type AgentRequest = {
  [A in keyof AgentParams]: { type: "request"; op_id: string; action: A; params: AgentParams[A] };
}[keyof AgentParams];
