import type { HarnessKind } from "@/daemon/types/ws";
import type { ParseContext, TranscriptNode } from "@/features/transcript/parse";
import { presentationKey } from "@/features/transcript/presentation";
import { normalizeTurnEvent } from "@/features/transcript/turns/normalize";
import { reduceTurnEvent } from "@/features/transcript/turns/reducer";
import type { TurnEvent, TurnWork } from "@/features/transcript/turns/types";
import { parseStoredLine, storedLineKey } from "./storedLine";

export function turnNodeAnchor(nodes: readonly TranscriptNode[]): NonNullable<TurnEvent["anchor"]> {
  const user = nodes.find((node) => node.kind === "user");
  const first = nodes.find((node) => ["assistant", "thinking", "tool", "diff", "plan"].includes(node.kind));
  return { userNodeKey: user ? presentationKey(user) : undefined,
    ...(first ? { firstNodeKey: presentationKey(first), firstNodeKind: first.kind,
      firstNodeText: "text" in first ? first.text : first.kind === "tool" ? first.target ?? first.label : undefined } : {}) };
}

export function turnNodeIdentities(nodes: readonly TranscriptNode[]): string[] {
  return nodes.filter((node) => ["user", "assistant", "thinking", "tool", "diff", "plan"].includes(node.kind))
    .map((node) => `node:${presentationKey(node)}`);
}

export function historyTurnEvents(harness: HarnessKind, entries: readonly string[], context: ParseContext,
  nativeId?: string | null): TurnEvent[] {
  return entries.flatMap((line) => {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { return []; }
    const nodes = parseStoredLine(harness, line, context);
    const anchor = turnNodeAnchor(nodes);
    const key = storedLineKey(harness, line);
    const event = normalizeTurnEvent(harness, raw, { key, nativeId, history: true });
    if (!event && !anchor.firstNodeKey && !anchor.userNodeKey) return [];
    return [{ key, phase: "content" as const, source: "history" as const, ...event, anchor,
      aliases: [...(event?.aliases ?? []), ...turnNodeIdentities(nodes)] }];
  });
}

export function mergeHistoryTurnEvents(previous: readonly TurnEvent[], incoming: readonly TurnEvent[], refresh: boolean): TurnEvent[] {
  const events = new Map<string, TurnEvent>();
  for (const event of refresh ? [...previous, ...incoming] : [...incoming, ...previous]) events.set(event.key, event);
  return [...events.values()];
}

export function historyTurnWork(events: readonly TurnEvent[]): TurnWork[] {
  return events.reduce<TurnWork[]>((turns, event) => reduceTurnEvent(turns, event), []);
}
