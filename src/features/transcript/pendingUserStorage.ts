import { composerStorageKey, readComposerStorage, writeComposerStorage } from "@/lib/composerStorage";
import type { PendingUser } from "./optimistic";
import type { TranscriptImage } from "./parse/images";

function images(value: unknown): TranscriptImage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((image: unknown) => {
    if (!image || typeof image !== "object" || !("source" in image) || typeof image.source !== "string") return [];
    return [{ source: image.source,
      ...("path" in image && typeof image.path === "string" ? { path: image.path } : {}),
      ...("name" in image && typeof image.name === "string" ? { name: image.name } : {}),
    }];
  });
}

export function readPendingUsers(sessionId: string): readonly PendingUser[] {
  const value = readComposerStorage<unknown>(composerStorageKey("pending", sessionId), []);
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): PendingUser[] => {
    if (!entry || typeof entry !== "object" || !("node" in entry) || !("baseline" in entry)) return [];
    const { node, baseline } = entry;
    if (!node || typeof node !== "object" || !("kind" in node) || node.kind !== "user" ||
      !("text" in node) || typeof node.text !== "string" || !("key" in node) || typeof node.key !== "string" ||
      !Array.isArray(baseline) || !baseline.every((key: unknown) => typeof key === "string")) return [];
    return [{ node: { kind: "user", key: node.key, text: node.text,
      images: images("images" in node ? node.images : undefined),
    }, baseline }];
  });
}

export function writePendingUsers(sessionId: string, pending: readonly PendingUser[]): void {
  writeComposerStorage(composerStorageKey("pending", sessionId), pending.length ? pending.map(({ node, baseline }) => ({
    node: { kind: node.kind, key: node.key, text: node.text, images: images(node.images) }, baseline,
  })) : null);
}
