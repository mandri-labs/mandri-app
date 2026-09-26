import type { TranscriptNode } from "@/features/transcript/parse/types";

type TextNode = Extract<TranscriptNode, { kind: "assistant" | "thinking" }>;

export function isClaudeText(node: TranscriptNode): node is TextNode {
  return (node.kind === "assistant" || node.kind === "thinking") && node.claude !== undefined;
}

export function sameClaudeBlock(existing: TranscriptNode, incoming: TranscriptNode): boolean {
  if (!isClaudeText(existing) || !isClaudeText(incoming) || existing.kind !== incoming.kind) return false;
  const a = existing.claude!;
  const b = incoming.claude!;
  if (a.messageId !== b.messageId) return false;
  if (a.blockId !== undefined && b.blockId !== undefined) return a.blockId === b.blockId;
  if (a.blockIndex !== undefined && b.blockIndex !== undefined) return a.blockIndex === b.blockIndex;
  // A persisted SDK fragment has a UUID but no native stream index. Match only
  // within this API message and content kind; preserve separate fragment UUIDs.
  return existing.text.startsWith(incoming.text) || incoming.text.startsWith(existing.text);
}

export function mergeClaudeBlock(existing: TextNode, incoming: TextNode): TextNode {
  const canonical = incoming.claude?.blockId ? incoming : existing.claude?.blockId ? existing : incoming;
  const content = existing.claude?.blockId && !incoming.claude?.blockId && existing.text.startsWith(incoming.text)
    ? existing : incoming;
  return { ...content, key: existing.key ?? incoming.key, claude: { ...existing.claude!, ...incoming.claude!,
    ...(canonical.claude?.blockId ? { blockId: canonical.claude.blockId } : {}),
  } };
}
