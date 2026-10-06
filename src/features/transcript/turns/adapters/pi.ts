import type { TurnEvent } from "../types";
import { piMessageKey } from "../../parse/pi";
import { record, timestamp } from "./shared";

export function piTurn(
  raw: Record<string, unknown>,
  _nativeId?: string | null,
  history = false,
): Partial<TurnEvent> | undefined {
  if (raw.type === "agent_start") return { phase: "activity", active: true };
  // A retry continues the same work interval. Completed low-level work keeps
  // session activity on until settlement, even if a queued prompt starts next.
  if (raw.type === "agent_end" && raw.willRetry === true) return { phase: "content", active: true };
  if (raw.type === "agent_end" || raw.type === "agent_settled") {
    const messages = Array.isArray(raw.messages) ? raw.messages.map(record) : [];
    const stop = messages.reverse().find((message) => message?.role === "assistant")?.stopReason;
    return {
      phase: "finish",
      active: raw.type === "agent_end" && typeof raw.willRetry === "boolean",
      outcome: stop === "error" ? "failed" : stop === "aborted" ? "stopped" : undefined,
    };
  }
  const message = record(raw.message);
  if (
    !message ||
    !["message", "message_start", "message_update", "message_end"].includes(String(raw.type))
  )
    return undefined;
  const key = piMessageKey(message);
  if (message.role === "user")
    return {
      key,
      identity: key,
      phase: "start",
      active: true,
      startedAt: timestamp(message.timestamp),
    };
  if (message.role === "assistant") {
    const finish =
      history && typeof message.stopReason === "string" && message.stopReason !== "toolUse";
    return {
      key,
      aliases: key ? [key] : [],
      phase: finish ? "finish" : "activity",
      // The assistant timestamp is its creation time; JSONL entry time records completion.
      active: finish ? false : true,
      endedAt: finish ? timestamp(raw.timestamp) : undefined,
      outcome: finish
        ? message.stopReason === "aborted"
          ? "stopped"
          : message.stopReason === "error"
            ? "failed"
            : "worked"
        : undefined,
    };
  }
  return { key, phase: "content" };
}
