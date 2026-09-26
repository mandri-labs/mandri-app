import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import type { CommandCatalogScope, NativeCommand } from "@/daemon/types/commands";
import type { CommandTransport } from "./service";

export interface CachedCatalog {
  commands: NativeCommand[];
  state: "loading" | "ready" | "unavailable";
  reason?: string | null;
}

export const EMPTY_CATALOG: CachedCatalog = { commands: [], state: "loading" };
export const commandCatalogStore = createStore(() => ({ entries: {} as Record<string, CachedCatalog> }));
const transportIds = new WeakMap<CommandTransport, number>();
const pending = new Map<string, Promise<void>>();
const snapshots = new Map<string, Promise<void>>();
let nextTransportId = 0;
let epoch = 0;

function transportPrefix(transport: CommandTransport): string {
  let id = transportIds.get(transport);
  if (id === undefined) { id = ++nextTransportId; transportIds.set(transport, id); }
  return `${daemonIdentity.getState().generation}:${id}:`;
}

export function commandCatalogKey(transport: CommandTransport, scope: CommandCatalogScope): string {
  return transportPrefix(transport) + JSON.stringify([scope.harness, scope.cwd || null, scope.profile_id ?? null, scope.execution_backend ?? "host", scope.privacy_mode ?? "none"]);
}

function save(key: string, catalog: CachedCatalog): void {
  commandCatalogStore.setState((state) => ({ entries: { ...state.entries, [key]: catalog } }));
}

export function resetCommandCatalogs(): void {
  epoch++;
  pending.clear(); snapshots.clear();
  commandCatalogStore.setState({ entries: {} });
}

export function preloadCommandCatalogs(transport: CommandTransport, refresh = false): Promise<void> {
  const prefix = transportPrefix(transport);
  if (!refresh && snapshots.has(prefix)) return snapshots.get(prefix)!;
  if (refresh) {
    epoch++;
    for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key);
    commandCatalogStore.setState((state) => ({ entries: Object.fromEntries(Object.entries(state.entries).filter(([key]) => !key.startsWith(prefix))) }));
  }
  const requestEpoch = epoch;
  const task = (async () => {
    if (!transport.catalogs) return;
    const result = await transport.catalogs();
    if (requestEpoch !== epoch || prefix !== transportPrefix(transport)) return;
    for (const catalog of result.catalogs) {
      save(commandCatalogKey(transport, catalog), catalog);
      if (catalog.cwd === result.default_cwd) save(commandCatalogKey(transport, { ...catalog, cwd: undefined }), catalog);
    }
  })().catch(() => undefined);
  snapshots.set(prefix, task);
  return task;
}

export function ensureCommandCatalog(transport: CommandTransport, scope: CommandCatalogScope, refresh = false): Promise<void> {
  const key = commandCatalogKey(transport, scope);
  const active = pending.get(key);
  if (active) return active;
  if (!refresh && commandCatalogStore.getState().entries[key]) return Promise.resolve();
  const requestEpoch = epoch;
  const task = (async () => {
    await preloadCommandCatalogs(transport);
    if (requestEpoch !== epoch || key !== commandCatalogKey(transport, scope)) return;
    if (!refresh && commandCatalogStore.getState().entries[key]) return;
    save(key, EMPTY_CATALOG);
    try {
      const result = await transport.catalog(scope, refresh);
      if (requestEpoch !== epoch || key !== commandCatalogKey(transport, scope)) return;
      save(key, { commands: result.commands, reason: result.reason, state: result.reason && !result.commands.length ? "unavailable" : "ready" });
    } catch (error) {
      if (requestEpoch !== epoch || key !== commandCatalogKey(transport, scope)) return;
      save(key, { commands: [], state: "unavailable", reason: error instanceof Error ? error.message : null });
    }
  })();
  pending.set(key, task);
  void task.finally(() => { if (pending.get(key) === task) pending.delete(key); });
  return task;
}
