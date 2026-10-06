import type { HarnessKind } from "@/daemon/types/ws";
import type { TurnEvent } from "./types";
import { piTurn } from "./adapters/pi";
import { agyTurn } from "./adapters/agy";
import { claudeTurn } from "./adapters/claude";
import { codexTurn } from "./adapters/codex";
import { opencodeTurn } from "./adapters/opencode";
import { record, timestamp } from "./adapters/shared";

const adapters = {
  pi: piTurn,
  agy: agyTurn,
  claude: claudeTurn,
  codex: codexTurn,
  opencode: opencodeTurn,
};

export function normalizeTurnEvent(
  harness: HarnessKind,
  value: unknown,
  options: {
    key: string;
    nativeId?: string | null;
    timestamp?: number;
    history?: boolean;
  },
): TurnEvent | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const normalized = adapters[harness](raw, options.nativeId, options.history);
  if (!normalized?.phase) return undefined;
  const at = timestamp(raw.timestamp) ?? timestamp(raw.created_at) ?? options.timestamp;
  const result: TurnEvent = {
    at,
    source: options.history ? "history" : undefined,
    ...normalized,
    key: normalized.key ?? options.key,
    phase: normalized.phase,
  };
  if (harness === "agy" && options.history && raw.type === "PLANNER_RESPONSE")
    result.at = undefined;
  const duration =
    raw.type === "result"
      ? raw.duration_ms
      : raw.subtype === "turn_duration"
        ? raw.durationMs
        : undefined;
  if (harness === "claude" && typeof duration === "number" && duration >= 0 && at !== undefined)
    result.startedAt = at - duration;
  return result;
}
