import { userContentKey } from "./parse/userContent";
import type { TranscriptNode } from "./parse/types";

export interface PendingDelivery {
  content: string;
  state: "preparing" | "sending" | "accepted" | "unknown" | "not_sent";
  filesKey?: string;
}

export interface PendingUser {
  delivery?: PendingDelivery;
  node: Extract<TranscriptNode, { kind: "user" }>;
  baseline: readonly string[];
}

// Unkeyed history nodes can contain megabytes of tool output. Store a compact
// content fingerprint rather than copying the entire history into every prompt.
function contentIdentity(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `hash:${value.length}:${first >>> 0}:${second >>> 0}`;
}

function nodeIdentity(node: TranscriptNode): string {
  return node.key ? `key:${node.key}` : contentIdentity(JSON.stringify(node));
}

export function pendingUserBaseline(nodes: readonly TranscriptNode[]): readonly string[] {
  return nodes.map(nodeIdentity);
}

function boundaryOf(baseline: readonly string[], nodes: readonly TranscriptNode[]): number {
  const identities = pendingUserBaseline(nodes);
  for (let i = baseline.length - 1; i >= 0; i -= 1) {
    // Continue reconciling recovery entries written by older desktop builds.
    const identity = baseline[i]!.startsWith("node:")
      ? contentIdentity(baseline[i]!.slice(5))
      : baseline[i];
    for (let j = nodes.length - 1; j >= 0; j -= 1) {
      if (identities[j] === identity) return j;
    }
  }
  return -1;
}

export function withPendingUsers(
  nodes: readonly TranscriptNode[],
  pending: readonly PendingUser[],
): readonly TranscriptNode[] {
  if (pending.length === 0) return nodes;
  const result = [...nodes];
  for (const entry of [...pending].reverse()) {
    const boundary = boundaryOf(entry.baseline, nodes);
    result.splice(
      boundary < 0 && entry.baseline.length > 0 ? result.length : boundary + 1,
      0,
      entry.node,
    );
  }
  return result;
}

export function reconcilePendingUsers(
  pending: readonly PendingUser[],
  nodes: readonly TranscriptNode[],
  onMatch?: (entry: PendingUser, index: number) => void,
): readonly PendingUser[] {
  const consumed = new Set<number>();
  const remaining = pending.flatMap((entry) => {
    const { node, baseline } = entry;
    const boundary = boundaryOf(baseline, nodes);
    if (baseline.length > 0 && boundary < 0) return [entry];
    const match = nodes.findIndex(
      (candidate, index) =>
        index > boundary &&
        !consumed.has(index) &&
        candidate.kind === "user" &&
        userContentKey(candidate) === userContentKey(node),
    );
    if (match < 0) {
      const previousMatch = [...consumed].filter((index) => {
        const candidate = nodes[index];
        return candidate?.kind === "user" && userContentKey(candidate) === userContentKey(node);
      });
      return previousMatch.length === 0
        ? [entry]
        : [
            {
              ...entry,
              baseline: pendingUserBaseline(nodes.slice(0, Math.max(...previousMatch) + 1)),
            },
          ];
    }
    consumed.add(match);
    onMatch?.(entry, match);
    return [];
  });
  return remaining.length === pending.length &&
    remaining.every((entry, index) => entry === pending[index])
    ? pending
    : remaining;
}

export function preserveLocalUserPresentation(
  previous: readonly TranscriptNode[],
  nodes: readonly TranscriptNode[],
  local: readonly PendingUser[],
): readonly TranscriptNode[] {
  const presentations = new Map<number, PendingUser["node"]["localPresentation"]>();
  reconcilePendingUsers(local, nodes, (entry, index) =>
    presentations.set(index, entry.node.localPresentation),
  );
  const previousByKey = new Map(
    previous.flatMap((node) =>
      node.kind === "user" && node.localPresentation ? [[node.key ?? node, node] as const] : [],
    ),
  );
  if (presentations.size === 0 && previousByKey.size === 0) return nodes;
  return nodes.map((node, index) => {
    if (node.kind !== "user") return node;
    const prior = previousByKey.get(node.key ?? node);
    const retained = prior?.localPresentation;
    const localPresentation = presentations.get(index);
    if (prior === node && (!localPresentation || localPresentation === retained)) return node;
    const presentation =
      localPresentation ??
      (retained && prior && userContentKey(prior) !== userContentKey(node)
        ? { key: retained.key }
        : retained);
    return presentation && presentation !== node.localPresentation
      ? { ...node, localPresentation: presentation }
      : node;
  });
}
