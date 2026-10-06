import type { TranscriptNode } from "@/features/transcript/parse/types";

type TextNode = Extract<TranscriptNode, { kind: "assistant" | "thinking" }>;

export function isClaudeText(node: TranscriptNode): node is TextNode {
  return (node.kind === "assistant" || node.kind === "thinking") && node.claude !== undefined;
}

export function sameClaudeBlock(existing: TranscriptNode, incoming: TranscriptNode): boolean {
  if (!isClaudeText(existing) || !isClaudeText(incoming) || existing.kind !== incoming.kind)
    return false;
  const a = existing.claude!;
  const b = incoming.claude!;
  if (a.messageId !== b.messageId) return false;
  if (a.blockId !== undefined && b.blockId !== undefined) return a.blockId === b.blockId;
  if (a.blockIndex !== undefined && b.blockIndex !== undefined)
    return a.blockIndex === b.blockIndex;
  // A persisted SDK fragment has a UUID but no native stream index. Match only
  // within this API message and content kind; preserve separate fragment UUIDs.
  return existing.text.startsWith(incoming.text) || incoming.text.startsWith(existing.text);
}

export function mergeClaudeBlock(existing: TextNode, incoming: TextNode): TextNode {
  const canonical = incoming.claude?.blockId
    ? incoming
    : existing.claude?.blockId
      ? existing
      : incoming;
  const content =
    existing.claude?.blockId && !incoming.claude?.blockId && existing.text.startsWith(incoming.text)
      ? existing
      : incoming;
  return {
    ...content,
    key: existing.key ?? incoming.key,
    ...(incoming.streaming === false ? { streaming: false, delta: false } : {}),
    claude: {
      ...existing.claude!,
      ...incoming.claude!,
      ...(canonical.claude?.blockId ? { blockId: canonical.claude.blockId } : {}),
    },
  };
}

export function alignClaudeHistory(
  history: readonly TranscriptNode[],
  live: readonly TranscriptNode[],
): TranscriptNode[] {
  const candidates = new Map<string, TextNode[]>();
  for (const node of live) {
    if (!isClaudeText(node)) continue;
    const key = `${node.kind}:${node.claude!.messageId}`;
    const group = candidates.get(key) ?? [];
    group.push(node);
    candidates.set(key, group);
  }
  const claimed = new Set<TextNode>();
  return history.map((stored) => {
    if (!isClaudeText(stored)) return stored;
    const matches = (candidates.get(`${stored.kind}:${stored.claude!.messageId}`) ?? []).filter(
      (node) => !claimed.has(node) && sameClaudeBlock(stored, node),
    );
    const match =
      matches.find(
        (node) =>
          node.key === stored.key ||
          (stored.claude!.blockId !== undefined && stored.claude!.blockId === node.claude!.blockId),
      ) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!match) return stored;
    claimed.add(match);
    return {
      ...stored,
      key: match.key ?? stored.key,
      claude: { ...match.claude!, ...stored.claude! },
    };
  });
}
