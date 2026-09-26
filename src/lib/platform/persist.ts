import { isTauri } from "./index";

export interface PreferenceStorage {
  load(key: string): string | null | Promise<string | null>;
  save(key: string, value: string): void;
  remove(key: string): void;
}

interface LocalPreferenceStorage {
  load(key: string): string | null;
  save(key: string, value: string): void;
  remove(key: string): void;
}

function createLocalStorageStorage(): LocalPreferenceStorage {
  return {
    load(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    save(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        return;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        return;
      }
    },
  };
}

type TauriPreferencesBridge = {
  read(): Promise<string | null>;
  write(key: string, value: string): void;
};

function createTauriBridge(): TauriPreferencesBridge {
  let queue: Promise<void> = Promise.resolve();
  return {
    read: async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<unknown>("preferences_read");
        return typeof raw === "string" ? raw : null;
      } catch {
        return null;
      }
    },
    write: (key, value) => {
      queue = queue
        .then(async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            let envelope: Record<string, string> = {};
            const raw = await invoke<unknown>("preferences_read");
            if (typeof raw === "string") {
              const parsed: unknown = JSON.parse(raw);
              if (parsed !== null && typeof parsed === "object") {
                envelope = parsed as Record<string, string>;
              }
            }
            envelope[key] = value;
            await invoke("preferences_write", { value: JSON.stringify(envelope) });
          } catch {
            return;
          }
        })
        .catch(() => undefined);
    },
  };
}

function createTauriStorage(): { storage: PreferenceStorage; ready: Promise<void> } {
  const bridge = createTauriBridge();
  const local = createLocalStorageStorage();
  let resolveReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const storage: PreferenceStorage = {
    load: async (key) => {
      // The browser's saved choice wins over an older desktop backup.
      const saved = local.load(key);
      if (saved !== null) {
        resolveReady?.();
        return saved;
      }
      let value: string | null = null;
      try {
        const envelopeRaw = await bridge.read();
        if (envelopeRaw !== null) {
          const parsed: unknown = JSON.parse(envelopeRaw);
          if (parsed !== null && typeof parsed === "object") {
            const entry = (parsed as Record<string, unknown>)[key];
            if (typeof entry === "string") {
              value = entry;
            }
          }
        }
      } catch {
        value = null;
      }
      if (value === null) {
        value = local.load(key);
      }
      resolveReady?.();
      return value;
    },
    save: (key, value) => {
      local.save(key, value);
      bridge.write(key, value);
    },
    remove: (key) => {
      local.remove(key);
      resolveReady?.();
    },
  };
  return { storage, ready };
}

const webStorage = createLocalStorageStorage();

let tauriStorage: PreferenceStorage | null = null;

let readyPromise: Promise<void> = Promise.resolve();

export function getPreferenceStorage(): PreferenceStorage {
  if (isTauri() && tauriStorage === null) {
    const created = createTauriStorage();
    tauriStorage = created.storage;
    readyPromise = created.ready;
  }
  return isTauri() && tauriStorage !== null ? tauriStorage : webStorage;
}

export function whenPreferenceStorageReady(): Promise<void> {
  return readyPromise;
}
