export type ConversationTarget = `session:${string}` | `agent:${string}`;

export interface ConversationStatus {
  target: string;
  revision: number;
  work_state: "idle" | "working" | "waiting" | "unknown";
  completion_revision: number;
  read_revision: number;
  outcome: "completed" | "failed" | "interrupted" | null;
  completion_key: string | null;
  cycle_active: boolean;
}

export function isUnread(status: ConversationStatus | undefined): boolean {
  return status !== undefined && status.completion_revision > status.read_revision;
}
