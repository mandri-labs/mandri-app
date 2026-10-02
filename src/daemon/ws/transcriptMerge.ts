import { alignCodexUsers } from "./codexUserIdentity";
import { isClaudeText, sameClaudeBlock, mergeClaudeBlock, alignClaudeHistory } from "./claudeBlockIdentity";
import type { TranscriptNode } from "@/features/transcript/parse";

function keyOf(node: TranscriptNode): string | undefined {
  return "key" in node ? node.key : undefined;
}

function replaceNode(existing: TranscriptNode, node: TranscriptNode): TranscriptNode {
  if (existing.kind === "assistant" && existing.questions && node.kind === "tool" && node.tool === "tool_result") {
    return existing;
  }
  if (existing.kind === "tool" && node.kind === "tool") {
    const result = node.tool === "tool_result" || node.update;
    const terminal = ["done", "failed", "cancelled"].includes(existing.status);
    const status = terminal && ["pending", "running", "waiting"].includes(node.status) ? existing.status : node.status;
    const retainActions = existing.actionSource === "native" && node.actionSource === "fallback";
    return { ...existing, ...node,
      tool: result ? existing.tool : node.tool, label: result ? existing.label : node.label,
      status, title: node.title ?? existing.title, actions: retainActions ? existing.actions : node.actions ?? existing.actions,
      actionSource: retainActions ? existing.actionSource : node.actionSource ?? existing.actionSource,
      target: node.target ?? existing.target, durationMs: node.durationMs ?? existing.durationMs,
      detailText: node.detailText ?? existing.detailText,
      native: existing.native || node.native ? { ...existing.native, ...Object.fromEntries(Object.entries(node.native ?? {}).filter(([, value]) => value !== undefined)) } : undefined,
      details: existing.details || node.details ? { input: node.details?.input ?? existing.details?.input,
        output: node.details?.output ?? existing.details?.output } : undefined,
      codex: existing.codex || node.codex ? {
        input: node.codex?.input ?? existing.codex?.input,
        output: node.codex?.outputDelta
          ? String(existing.codex?.output ?? "") + String(node.codex.output ?? "")
          : node.codex?.output ?? existing.codex?.output,
      } : undefined,
    };
  }
  if (isClaudeText(existing) && isClaudeText(node)) return mergeClaudeBlock(existing, node);
  return node;
}

export function appendTranscriptNodes(
  previous: readonly TranscriptNode[],
  incoming: readonly TranscriptNode[],
): TranscriptNode[] {
  const nodes = [...previous];
  const indices = new Map<string, number>();
  const claudeIndices = new Map<string, number[]>();
  const indexClaudeNode = (node: TranscriptNode, index: number) => {
    if (!isClaudeText(node)) return;
    const messageKey = `${node.kind}:${node.claude!.messageId}`;
    const group = claudeIndices.get(messageKey) ?? [];
    group.push(index);
    claudeIndices.set(messageKey, group);
  };
  nodes.forEach((node, index) => {
    indexClaudeNode(node, index);
    const key = keyOf(node);
    if (key !== undefined) indices.set(key, index);
  });
  for (const node of incoming) {
    const key = keyOf(node);
    let index = key === undefined ? undefined : indices.get(key);
    if (index === undefined && isClaudeText(node)) {
      const candidates = claudeIndices.get(`${node.kind}:${node.claude!.messageId}`) ?? [];
      index = candidates.find((candidate) => sameClaudeBlock(nodes[candidate]!, node) &&
        "text" in nodes[candidate]! && nodes[candidate]!.text === node.text)
        ?? candidates.find((candidate) => sameClaudeBlock(nodes[candidate]!, node));
      if (index !== undefined && key !== undefined) indices.set(key, index);
    }
    const existing = index === undefined ? undefined : nodes[index];
    if (existing === undefined || index === undefined) {
      if (key !== undefined) indices.set(key, nodes.length);
      indexClaudeNode(node, nodes.length);
      nodes.push(node);
    } else if (
      (node.kind === "assistant" && existing.kind === "assistant" ||
        node.kind === "thinking" && existing.kind === "thinking") && (node.delta ?? node.streaming) === true
    ) {
      nodes[index] = { ...node, text: existing.text + node.text,
        ...(node.kind === "thinking" && existing.kind === "thinking"
          ? { summary: node.summary === undefined ? existing.summary : (existing.summary ?? "") + node.summary } : {}),
      };
    } else {
      nodes[index] = replaceNode(existing, node);
    }
  }
  return nodes;
}

function sameBoundaryNode(a: TranscriptNode, b: TranscriptNode): boolean {
  const aKey = keyOf(a);
  const bKey = keyOf(b);
  if (aKey !== undefined && bKey !== undefined && aKey !== bKey) return false;
  return a.kind === b.kind && "text" in a && "text" in b && a.text === b.text;
}

function preserveLiveOrder(
  history: readonly TranscriptNode[],
  live: readonly TranscriptNode[],
  merged: readonly TranscriptNode[],
): TranscriptNode[] {
  const identity = (node: TranscriptNode) => keyOf(node) ?? node;
  const historyIds = new Set(history.map(identity));
  const mergedNodes = new Map(merged.map((node) => [identity(node), node]));
  const before = new Map<string | TranscriptNode, TranscriptNode[]>();
  const inserted = new Set<TranscriptNode>();
  let pending: TranscriptNode[] = [];
  for (const node of live) {
    const id = identity(node);
    if (historyIds.has(id)) {
      if (pending.length) {
        before.set(id, pending);
        pending.forEach((entry) => inserted.add(entry));
        pending = [];
      }
    } else {
      const entry = mergedNodes.get(id);
      if (entry) pending.push(entry);
    }
  }
  return merged.flatMap((node) => inserted.has(node) ? [] : [...(before.get(identity(node)) ?? []), node]);
}

function alignStoredText(
  history: readonly TranscriptNode[],
  live: readonly TranscriptNode[],
): TranscriptNode[] {
  const positions = new Map(history.flatMap((node, index) => node.key ? [[node.key, index] as const] : []));
  const aligned = [...history];
  const claimed = new Set<number>();
  for (const [index, node] of live.entries()) {
    if (!node.key || positions.has(node.key) || !["assistant", "thinking"].includes(node.kind) || !("text" in node)) continue;
    const before = live.slice(0, index).reverse().find((entry) => entry.key && positions.has(entry.key));
    const after = live.slice(index + 1).find((entry) => entry.key && positions.has(entry.key));
    if (!before && !after) continue;
    const start = before?.key ? positions.get(before.key)! + 1 : 0;
    const end = after?.key ? positions.get(after.key)! : history.length;
    const candidates = history.flatMap((stored, position) => position >= start && position < end &&
      !claimed.has(position) && stored.key?.startsWith("stored:") && stored.kind === node.kind &&
      "text" in stored && stored.text === node.text ? [position] : []);
    if (candidates.length !== 1) continue;
    const position = candidates[0]!;
    aligned[position] = { ...history[position]!, key: node.key };
    claimed.add(position);
  }
  return aligned;
}

export function mergeHistoryAndLive(
  storedHistory: readonly TranscriptNode[],
  live: readonly TranscriptNode[],
): TranscriptNode[] {
  const history = alignStoredText(alignClaudeHistory(alignCodexUsers(storedHistory, live), live), live);
  let overlap = Math.min(history.length, live.length);
  while (overlap > 0) {
    if (live.slice(0, overlap).every((node, index) => {
      const previous = history[history.length - overlap + index];
      return previous !== undefined && sameBoundaryNode(previous, node);
    })) break;
    overlap -= 1;
  }
  const historyKeys = new Map(history.map((node) => [keyOf(node), node]));
  const remaining = live.slice(overlap).filter((node) => {
    const key = keyOf(node);
    const stored = key === undefined ? undefined : historyKeys.get(key);
    if (stored === undefined) return true;
    if ("text" in stored && "text" in node) return !stored.text.startsWith(node.text);
    return true;
  });
  const snapshots = remaining.map((node) => {
    const key = keyOf(node);
    const stored = key === undefined ? undefined : historyKeys.get(key);
    if (stored !== undefined && "text" in stored &&
      (node.kind === "assistant" || node.kind === "thinking") &&
      node.text.startsWith(stored.text)) {
      return { ...node, delta: false };
    }
    return node;
  });
  return preserveLiveOrder(history, live, appendTranscriptNodes(history, snapshots));
}
