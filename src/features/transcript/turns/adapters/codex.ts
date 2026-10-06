import type { TurnEvent } from "../types";
import { belongsTo, identity, record, text } from "./shared";

export function codexTurn(
  raw: Record<string, unknown>,
  nativeId?: string | null,
): Partial<TurnEvent> | undefined {
  const params = record(raw.params);
  if (!belongsTo(nativeId, params?.threadId)) return undefined;
  const payload = record(raw.payload);
  const kind = raw.type === "event_msg" ? payload?.type : raw.method;
  const turn = record(params?.turn);
  const turnId = identity("codex:turn", payload?.turn_id ?? turn?.id ?? params?.turnId);
  const item = record(params?.item ?? payload?.item);
  const itemId = identity("codex:item", item?.id ?? params?.itemId);
  const common = { identity: turnId, aliases: itemId ? [itemId] : [] };
  if (kind === "task_started" || kind === "turn/started")
    return { ...common, phase: "start", active: true };
  if (
    ["task_complete", "task_aborted", "turn_aborted", "turn/completed"].includes(String(kind)) ||
    (kind === "error" && params?.willRetry === false)
  ) {
    const status = text(turn?.status);
    return {
      ...common,
      phase: "finish",
      active: false,
      outcome:
        kind === "task_aborted" || kind === "turn_aborted" || status === "interrupted"
          ? "stopped"
          : payload?.error || status === "failed" || kind === "error"
            ? "failed"
            : "worked",
    };
  }
  if (turnId || itemId) return { ...common, phase: "content" };
  return undefined;
}
