import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonIdentity } from "@/daemon/identity";
import type { CommandCatalog, NativeCommand } from "@/daemon/types/commands";
import { commandCatalogKey, commandCatalogStore, ensureCommandCatalog, preloadCommandCatalogs, resetCommandCatalogs } from "./catalogCache";
import type { CommandTransport } from "./service";

const command: NativeCommand = { id: "custom", name: "custom", description: "Discovered command", aliases: [], kind: "prompt" };
const scope = { harness: "claude" as const, cwd: "/project" };
function transportFor(): CommandTransport {
  return { catalog: vi.fn(async () => ({ commands: [command] })), invoke: vi.fn(), list: vi.fn(), cancel: vi.fn() };
}
function catalog(cwd: string): CommandCatalog {
  return { harness: "claude", cwd, profile_id: null, execution_backend: "host", privacy_mode: "none", state: "ready", commands: [command] };
}
afterEach(resetCommandCatalogs);

describe("scoped native catalog cache", () => {
  it("loads a connection snapshot once and serves its scoped and default entries without new discovery", async () => {
    const transport = transportFor();
    transport.catalogs = vi.fn(async () => ({ catalogs: [catalog("/project"), { ...catalog("/different"), commands: [] }], default_cwd: "/project" }));
    await preloadCommandCatalogs(transport);
    await Promise.all([ensureCommandCatalog(transport, scope), ensureCommandCatalog(transport, { harness: "claude" })]);
    await preloadCommandCatalogs(transport);
    expect(transport.catalogs).toHaveBeenCalledOnce();
    expect(transport.catalog).not.toHaveBeenCalled();
    expect(commandCatalogStore.getState().entries[commandCatalogKey(transport, { harness: "claude" })]?.commands).toEqual([command]);
  });

  it("deduplicates parallel readers and caches before any slash palette opens", async () => {
    const transport = transportFor();
    await Promise.all([ensureCommandCatalog(transport, scope), ensureCommandCatalog(transport, scope)]);
    await ensureCommandCatalog(transport, scope);
    expect(transport.catalog).toHaveBeenCalledOnce();
    expect(commandCatalogStore.getState().entries[commandCatalogKey(transport, scope)]?.state).toBe("ready");
  });

  it("does not reuse catalog entries across workspaces, profiles or execution backends", async () => {
    const transport = transportFor();
    await ensureCommandCatalog(transport, scope);
    await ensureCommandCatalog(transport, { ...scope, cwd: "/other" });
    await ensureCommandCatalog(transport, { ...scope, profile_id: "separate" });
    await ensureCommandCatalog(transport, { ...scope, execution_backend: "docker" });
    await ensureCommandCatalog(transport, { ...scope, privacy_mode: "surrogate" });
    expect(transport.catalog).toHaveBeenCalledTimes(5);
  });

  it("keeps discovery failure until explicit refresh rather than retrying on palette open", async () => {
    const transport = transportFor();
    transport.catalog = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({ commands: [command] });
    await ensureCommandCatalog(transport, scope);
    await ensureCommandCatalog(transport, scope);
    expect(transport.catalog).toHaveBeenCalledOnce();
    expect(commandCatalogStore.getState().entries[commandCatalogKey(transport, scope)]?.state).toBe("unavailable");
    await ensureCommandCatalog(transport, scope, true);
    expect(transport.catalog).toHaveBeenCalledTimes(2);
    expect(transport.catalog).toHaveBeenLastCalledWith(scope, true);
  });

  it("discards an old endpoint response after the daemon changes", async () => {
    const transport = transportFor();
    let finish!: (result: { commands: NativeCommand[] }) => void;
    transport.catalog = vi.fn(() => new Promise<{ commands: NativeCommand[] }>((resolve) => { finish = resolve; }));
    const request = ensureCommandCatalog(transport, scope);
    await Promise.resolve(); await Promise.resolve();
    const oldKey = commandCatalogKey(transport, scope);
    daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
    resetCommandCatalogs();
    finish({ commands: [command] });
    await request;
    expect(commandCatalogStore.getState().entries[oldKey]).toBeUndefined();
  });

  it("refreshes connection snapshots without inheriting a removed command", async () => {
    const transport = transportFor();
    transport.catalogs = vi.fn().mockResolvedValueOnce({ catalogs: [catalog("/project")], default_cwd: "/project" })
      .mockResolvedValueOnce({ catalogs: [{ ...catalog("/project"), commands: [] }], default_cwd: "/project" });
    await preloadCommandCatalogs(transport);
    await preloadCommandCatalogs(transport, true);
    expect(commandCatalogStore.getState().entries[commandCatalogKey(transport, scope)]?.commands).toEqual([]);
  });
});
