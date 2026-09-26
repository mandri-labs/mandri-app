import type { TranscriptNode } from "./parse/types";
import { asRecord, stringAt } from "./parse/shared";

const nodeIds = new WeakMap<TranscriptNode, string>();
let nextId = 0;
export function presentationKey(node: TranscriptNode): string {
  if ("key" in node && node.key !== undefined) return `${node.kind}:${node.key}`;
  let id = nodeIds.get(node);
  if (id === undefined) {
    id = `node-${nextId++}`;
    nodeIds.set(node, id);
  }
  return id;
}

export function presentTranscript(
  nodes: readonly TranscriptNode[],
  showTechnicalEvents = false,
): TranscriptNode[] {
  const visible: TranscriptNode[] = [];
  const pending: unknown[] = [];
  for (const node of nodes) {
    if (node.kind === "raw") {
      if (!showTechnicalEvents) continue;
      const raw = asRecord(node.payload);
      const type = stringAt(raw, "type") ?? stringAt(raw, "method") ?? stringAt(raw, "event") ?? "";
      // Unknown action/error events remain in place and individually discoverable.
      if (!/error|approval|permission|context/i.test(type)) {
        pending.push(node.payload);
        continue;
      }
    }
    const previous = visible.at(-1);
    if (node.kind === "user" && node.messageId && previous?.kind === "user" && previous.messageId === node.messageId) {
      visible[visible.length - 1] = { ...previous,
        text: [previous.text, node.text].filter(Boolean).join("\n"),
        images: [...(previous.images ?? []), ...(node.images ?? [])],
      };
      continue;
    }
    visible.push(node);
  }
  if (pending.length > 0)
    visible.push({ kind: "raw", harness: "", payload: pending, key: "diagnostics" });
  return visible;
}
