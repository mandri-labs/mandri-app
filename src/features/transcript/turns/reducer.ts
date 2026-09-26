import { turnCompleted, type TurnEvent, type TurnWork } from "./types";

const identities = (turn: TurnWork) => new Set([turn.id, ...(turn.identities ?? [])]);
const minimum = (a?: number, b?: number) => a === undefined ? b : b === undefined ? a : Math.min(a, b);

function mergeTurn(a: TurnWork, b: TurnWork): TurnWork {
  const outcome = a.outcome && a.outcome !== "worked" ? a.outcome : b.outcome ?? a.outcome;
  return {
    ...a,
    ...b,
    id: a.id,
    nativeId: b.nativeId ?? a.nativeId,
    identities: [...new Set([...identities(a), ...identities(b)])],
    source: a.source === "history" && b.source === "history" ? "history" : undefined,
    startedAt: minimum(a.startedAt, b.startedAt),
    endedAt: a.outcome && a.outcome !== "worked" ? a.endedAt : b.endedAt ?? a.endedAt,
    outcome,
    firstNodeKey: b.firstNodeKey ?? a.firstNodeKey,
    firstNodeKind: b.firstNodeKind ?? a.firstNodeKind,
    firstNodeText: b.firstNodeText ?? a.firstNodeText,
    userNodeKey: b.userNodeKey ?? a.userNodeKey,
  };
}

export function reduceTurnEvent(previous: readonly TurnWork[], event: TurnEvent): TurnWork[] {
  const keys = [...(event.identity ? [event.identity] : []), ...(event.aliases ?? [])];
  let index = previous.findIndex((turn) => turn.id === event.key ||
    keys.some((key) => turn.id === key || turn.identities?.includes(key)));
  if (index < 0) {
    const current = previous.at(-1);
    if (current && (!turnCompleted(current) || (event.source === "history" && event.phase !== "start")) &&
      !(event.identity && current.nativeId && current.nativeId !== event.identity)) {
      index = previous.length - 1;
    }
  }
  if (index < 0 && event.phase === "content") return [...previous];
  if (index < 0 && event.phase === "finish" && !event.identity && !event.aliases?.length) return [...previous];
  const existing = index < 0 ? undefined : previous[index];
  const start = event.startedAt ?? (event.phase === "start" || event.phase === "activity" ? event.at : undefined);
  const next: TurnWork = {
    id: existing?.id ?? event.identity ?? event.aliases?.[0] ?? event.key,
    identities: keys,
    nativeId: event.identity,
    source: event.source,
    startedAt: start,
    endedAt: event.endedAt ?? (event.phase === "finish" ? event.at : undefined),
    outcome: event.phase === "finish" ? event.outcome ?? "worked" : undefined,
    ...event.anchor,
  };
  if (!existing) return [...previous, next];
  const turns = [...previous];
  turns[index] = mergeTurn(existing, next);
  if (existing.firstNodeKey) {
    turns[index] = { ...turns[index]!, firstNodeKey: existing.firstNodeKey,
      firstNodeKind: existing.firstNodeKind, firstNodeText: existing.firstNodeText };
  }
  return turns;
}

export function mergeTurnWork(previous: readonly TurnWork[], history: readonly TurnWork[]): TurnWork[] {
  const remaining = [...previous];
  const merged = history.map((stored) => {
    const keys = identities(stored);
    const matches = remaining.filter((live) => [...identities(live)].some((key) => keys.has(key)) ||
      (stored.firstNodeKey !== undefined && stored.firstNodeKey === live.firstNodeKey) ||
      (stored.userNodeKey !== undefined && stored.userNodeKey === live.userNodeKey));
    for (const match of matches) remaining.splice(remaining.indexOf(match), 1);
    return matches.reduce((turn, live) => mergeTurn(live, turn), stored);
  });
  return [...merged, ...remaining].sort((a, b) =>
    (a.startedAt ?? a.endedAt ?? Infinity) - (b.startedAt ?? b.endedAt ?? Infinity));
}
