import type { TranscriptNode } from "./parse/types";

// A controlled process stop ends activity, but late transcript content still belongs
// to the conversation. Preserve that content without presenting it as running.
export function stoppedNodes(nodes: readonly TranscriptNode[]): TranscriptNode[] {
  return nodes.map((node) => {
    if (node.kind === "tool" && ["pending", "running", "waiting"].includes(node.status)) {
      return { ...node, status: "cancelled" };
    }
    if ((node.kind === "assistant" || node.kind === "thinking") && node.streaming !== false) {
      return { ...node, streaming: false };
    }
    return node;
  });
}
