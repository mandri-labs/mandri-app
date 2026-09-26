import { userContentKey } from "./parse/userContent";
import type { TranscriptNode } from "./parse/types";

export interface PendingUser {
  node: Extract<TranscriptNode, { kind: "user" }>;
  baseline: readonly TranscriptNode[];
}

function sameNode(left: TranscriptNode, right: TranscriptNode): boolean {
  if ("key" in left && left.key && "key" in right && right.key) return left.key === right.key;
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundaryOf(baseline: readonly TranscriptNode[], nodes: readonly TranscriptNode[]): number {
  for (let i = baseline.length - 1; i >= 0; i -= 1) {
    for (let j = nodes.length - 1; j >= 0; j -= 1) {
      if (sameNode(nodes[j]!, baseline[i]!)) return j;
    }
  }
  return -1;
}

export function withPendingUsers(
  nodes: readonly TranscriptNode[], pending: readonly PendingUser[],
): readonly TranscriptNode[] {
  if (pending.length === 0) return nodes;
  const result = [...nodes];
  for (const entry of [...pending].reverse()) {
    const boundary = boundaryOf(entry.baseline, nodes);
    result.splice(boundary < 0 && entry.baseline.length > 0 ? result.length : boundary + 1, 0, entry.node);
  }
  return result;
}

export function reconcilePendingUsers(
  pending: readonly PendingUser[], nodes: readonly TranscriptNode[],
): readonly PendingUser[] {
  const consumed = new Set<number>();
  return pending.flatMap((entry) => {
    const { node, baseline } = entry;
    const boundary = boundaryOf(baseline, nodes);
    if (baseline.length > 0 && boundary < 0) return [entry];
    const match = nodes.findIndex((candidate, index) => index > boundary && !consumed.has(index)
      && candidate.kind === "user" && userContentKey(candidate) === userContentKey(node));
    if (match < 0) {
      const previousMatch = [...consumed].filter((index) => {
        const candidate = nodes[index];
        return candidate?.kind === "user" && userContentKey(candidate) === userContentKey(node);
      });
      return previousMatch.length === 0 ? [entry]
        : [{ ...entry, baseline: nodes.slice(0, Math.max(...previousMatch) + 1) }];
    }
    consumed.add(match);
    return [];
  });
}
