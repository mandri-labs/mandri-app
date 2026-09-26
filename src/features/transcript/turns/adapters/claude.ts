import type { TurnEvent } from "../types";
import { belongsTo, identity, record } from "./shared";

export function claudeTurn(raw: Record<string, unknown>, nativeId?: string | null, history = false): Partial<TurnEvent> | undefined {
  if (raw.parent_tool_use_id || !belongsTo(nativeId, raw.session_id ?? raw.sessionId)) return undefined;
  if (raw.isMeta === true || raw.isSynthetic === true || raw.turnCompanion === true)
    return history ? undefined : { phase: "content", active: true };
  const stream = record(raw.event);
  const message = record(raw.message ?? stream?.message);
  if (message?.model === "<synthetic>") return undefined;
  const messageId = identity("claude:message", message?.id);
  const userId = identity("claude:user", raw.uuid);
  const aliases = messageId ? [messageId] : [];
  if (raw.type === "system" && raw.subtype === "turn_duration") return { phase: "finish", active: false };
  if (raw.type === "result") return {
    phase: "finish", active: typeof raw.queued_turn_count === "number" && raw.queued_turn_count > 0,
    outcome: raw.is_error === true ? "failed" : "worked",
  };
  if (raw.type === "user") {
    const content = message?.content;
    if (Array.isArray(content) && content.some((part) => record(part)?.type === "tool_result")) return undefined;
    return { phase: "start", identity: userId, active: true };
  }
  if (raw.type === "assistant" || (raw.type === "stream_event" && stream?.type === "message_start")) {
    const finished = history && ["end_turn", "stop_sequence", "max_tokens"].includes(String(message?.stop_reason));
    return { phase: finished ? "finish" : "activity", aliases, active: !finished };
  }
  return undefined;
}
