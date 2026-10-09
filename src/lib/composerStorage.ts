import { daemonIdentity } from "@/daemon/identity";
import { createDebugLogger } from "@/lib/debug";

const log = createDebugLogger("composer-storage");

export function composerStorageKey(kind: string, id = ""): string {
  return `mandri.composer.v1:${encodeURIComponent(daemonIdentity.getState().baseUrl)}:${kind}:${encodeURIComponent(id)}`;
}

export function readComposerStorage<T>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return value === null ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

export function writeComposerStorage(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    // Log the category, never draft text, attachment bytes, or session identifiers.
    log.warn("persistence failed; continuing in memory", {
      operation: value === null ? "remove" : "write",
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
}

export function readSessionDrafts(): Record<string, string> {
  const value = readComposerStorage<Record<string, unknown>>(composerStorageKey("text"), {});
  const legacy =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  const drafts = { ...legacy };
  const prefix = composerStorageKey("draft");
  const stored = new Set<string>();
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const text = readComposerStorage<unknown>(key, null);
      if (typeof text !== "string") continue;
      try {
        const id = decodeURIComponent(key.slice(prefix.length));
        drafts[id] = text;
        stored.add(id);
      } catch {
        // Ignore malformed keys without hiding other valid drafts.
      }
    }
    // Migrate once, outside typing. Keep the legacy copy if any write fails,
    // and roll back new copies so a full storage quota does not block editing.
    if (Object.keys(legacy).length > 0) {
      const copied: string[] = [];
      try {
        for (const [id, text] of Object.entries(legacy)) {
          if (stored.has(id)) continue;
          if (!writeSessionDraft(id, text)) throw new Error("Draft migration unavailable");
          copied.push(id);
        }
        localStorage.removeItem(composerStorageKey("text"));
      } catch {
        for (const id of copied) localStorage.removeItem(composerStorageKey("draft", id));
      }
    }
  } catch {
    // In-memory drafts remain usable when persistent storage is unavailable.
  }
  return Object.fromEntries(Object.entries(drafts).filter(([, text]) => text.length > 0));
}

export function writeSessionDraft(sessionId: string, text: string): boolean {
  // Empty entries also override legacy drafts if a migration was interrupted.
  return writeComposerStorage(composerStorageKey("draft", sessionId), text);
}
