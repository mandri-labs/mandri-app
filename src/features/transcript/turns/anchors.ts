import type { TranscriptNode } from "../parse/types";
import { presentationKey } from "../presentation";
import type { TurnWork } from "./types";

export function turnAnchors(nodes: readonly TranscriptNode[], turns: readonly TurnWork[]): Map<string, number> {
  const positions = new Map(nodes.map((node, index) => [presentationKey(node), index]));
  nodes.forEach((node, index) => {
    if ((node.kind !== "assistant" && node.kind !== "thinking") || !node.claude) return;
    const { messageId, blockIndex, blockId } = node.claude;
    if (blockIndex !== undefined) positions.set(`${node.kind}:${messageId}:${node.kind}:${blockIndex}`, index);
    if (blockId !== undefined) {
      const separator = blockId.lastIndexOf(":");
      positions.set(`${node.kind}:${blockId.slice(0, separator)}:${node.kind}:${blockId.slice(separator + 1)}`, index);
    }
  });
  const anchors = new Map<string, number>();
  let previous = -1;
  for (const turn of turns) {
    let index = turn.firstNodeKey ? positions.get(turn.firstNodeKey) : undefined;
    if (index === undefined && turn.firstNodeText) {
      const match = nodes.findIndex((node, position) => position > previous && node.kind === turn.firstNodeKind &&
        ("text" in node ? node.text : node.kind === "tool" ? (node.target ?? node.label) : "").startsWith(turn.firstNodeText!));
      if (match >= 0) index = match;
    }
    if (index === undefined && turn.userNodeKey) {
      const user = positions.get(turn.userNodeKey);
      if (user !== undefined) index = user + 1;
    }
    if (index !== undefined) {
      anchors.set(turn.id, index);
      previous = index;
    }
  }
  return anchors;
}
