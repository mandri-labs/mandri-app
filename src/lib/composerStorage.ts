import { daemonIdentity } from "@/daemon/identity";

export function composerStorageKey(kind: string, id = ""): string {
  return `mandri.composer.v1:${encodeURIComponent(daemonIdentity.getState().baseUrl)}:${kind}:${encodeURIComponent(id)}`;
}

export function readComposerStorage<T>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return value === null ? fallback : value as T;
  } catch {
    return fallback;
  }
}

export function writeComposerStorage(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readSessionDrafts(): Record<string, string> {
  const value = readComposerStorage<Record<string, unknown>>(composerStorageKey("text"), {});
  return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === "string")) as Record<string, string>;
}
