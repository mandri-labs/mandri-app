import type { TurnEvent } from "../types";
import { belongsTo, identity, record, timestamp } from "./shared";

export function agyTurn(raw: Record<string, unknown>, nativeId?: string | null, history = false): Partial<TurnEvent> | undefined {
  const step = record(raw.step_update);
  const data = record(raw.data);
  if (!belongsTo(nativeId, step?.conversation_id ?? data?.conversationId ?? raw.conversation_id)) return undefined;
  if (raw.event === "hook") {
    if (raw.hook === "Stop" && typeof data?.fullyIdle === "boolean")
      return { phase: data.fullyIdle ? "finish" : "activity", active: !data.fullyIdle };
    if (raw.hook === "PreInvocation") return { phase: "activity", active: true };
  }
  const value = step ?? raw;
  const key = identity("agy:step", value.step_index);
  const type = value.step_type ?? value.type;
  const state = value.state ?? value.status;
  const common = { key, aliases: key ? [key] : [] };
  if (type === "user_input" || type === "USER_INPUT") {
    if (value.source === "SYSTEM") return undefined;
    return { ...common, phase: "start", identity: key, active: true };
  }
  if (history && type === "PLANNER_RESPONSE" && state === "DONE" &&
    !(Array.isArray(value.tool_calls) && value.tool_calls.length)) {
    return { ...common, phase: "finish", active: false, endedAt: timestamp(value.completed_at) };
  }
  if (step && state === "ACTIVE") return { ...common, phase: "activity", active: true };
  if (key) return { ...common, phase: "content" };
  return undefined;
}
