import type { TurnEvent } from "../types";
import { belongsTo, identity, record, timestamp } from "./shared";

export function opencodeTurn(raw: Record<string, unknown>, nativeId?: string | null): Partial<TurnEvent> | undefined {
  const properties = record(raw.properties);
  const info = record(properties?.info);
  const part = record(properties?.part);
  if (!belongsTo(nativeId, properties?.sessionID ?? info?.sessionID ?? part?.sessionID)) return undefined;
  if (typeof raw.type === "string" && raw.type.startsWith("session.") && typeof properties?.sessionID !== "string") return undefined;
  const status = record(properties?.status)?.type ?? properties?.status;
  if (raw.type === "session.error") return { phase: "finish", active: false, outcome: "failed" };
  if (raw.type === "session.idle" || (raw.type === "session.status" && status === "idle"))
    return { phase: "finish", active: false };
  if (raw.type === "session.status" && (status === "busy" || status === "retry"))
    return { phase: "activity", active: true };
  if (raw.type === "message.updated" && info) {
    const messageId = identity("opencode:message", info.id);
    const time = record(info.time);
    if (info.role === "user") return { key: messageId, phase: "start", identity: messageId, startedAt: timestamp(time?.created), active: true };
    if (info.role === "assistant") {
      const completed = timestamp(time?.completed);
      const finished = info.error != null || (completed !== undefined && !info.summary &&
        typeof info.finish === "string" && !["tool-calls", "unknown"].includes(info.finish));
      const error = record(info.error);
      return { key: messageId, phase: finished ? "finish" : "activity", identity: identity("opencode:message", info.parentID),
        aliases: messageId ? [messageId] : [],
        endedAt: finished ? completed : undefined, active: finished ? false : undefined,
        outcome: finished ? error?.name === "MessageAbortedError" ? "stopped" : info.error ? "failed" : "worked" : undefined };
    }
  }
  const messageId = identity("opencode:message", part?.messageID ?? properties?.messageID);
  if (messageId) return { phase: "content", aliases: [messageId] };
  return undefined;
}
