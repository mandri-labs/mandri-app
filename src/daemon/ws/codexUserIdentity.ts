import type { TranscriptNode } from "@/features/transcript/parse";
import { userContentKey } from "@/features/transcript/parse/userContent";

export function alignCodexUsers(
  history: readonly TranscriptNode[],
  live: readonly TranscriptNode[],
): readonly TranscriptNode[] {
  const positions = new Map<string, number[]>();
  const liveKeys = new Set(live.flatMap((node) => node.key ? [node.key] : []));
  const identity = (node: Extract<TranscriptNode, { kind: "user" }>) =>
    JSON.stringify([node.codexUser!.turnId, userContentKey(node)]);
  history.forEach((node, index) => {
    if (node.kind !== "user" || (!node.codexUser || node.codexUser.itemId) || (node.key && liveKeys.has(node.key))) return;
    const key = identity(node);
    const group = positions.get(key) ?? [];
    group.push(index);
    positions.set(key, group);
  });
  const historyPositions = new Map(history.flatMap((node, index) => node.key ? [[node.key, index] as const] : []));
  const aligned = [...history];
  for (const [liveIndex, node] of live.entries()) {
    if (node.kind !== "user" || !node.codexUser?.itemId || !node.key || historyPositions.has(node.key)) continue;
    const before = live.slice(0, liveIndex).reverse().find((entry) => entry.key && historyPositions.has(entry.key));
    const after = live.slice(liveIndex + 1).find((entry) => entry.key && historyPositions.has(entry.key));
    const start = before?.key ? historyPositions.get(before.key)! : -1;
    const end = after?.key ? historyPositions.get(after.key)! : history.length;
    const candidates = positions.get(identity(node));
    const match = candidates?.findIndex((index) => index > start && index < end) ?? -1;
    const index = match < 0 ? undefined : candidates!.splice(match, 1)[0];
    const stored = index === undefined ? undefined : history[index];
    if (index !== undefined && stored?.kind === "user") {
      aligned[index] = { ...stored, key: node.key, codexUser: node.codexUser };
      historyPositions.set(node.key, index);
    }
  }
  return aligned;
}
