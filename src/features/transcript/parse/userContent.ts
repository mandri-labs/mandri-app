import { imageIdentity, userImages } from "./images";
import type { TranscriptNode } from "./types";

export function userContentKey(node: Extract<TranscriptNode, { kind: "user" }>): string {
  const content = userImages(node.text, node.images);
  return JSON.stringify([content.text, content.images.map(imageIdentity)]);
}
