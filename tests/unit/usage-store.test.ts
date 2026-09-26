import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createUsageStore } from "@/stores/usage";
import { daemonIdentity, selectDaemon } from "@/daemon/identity";
import { connectionStore } from "@/stores/connection";
import type { UsageOverview } from "@/daemon/rest/usage";
import { overview, usageQuery } from "./usage-fixtures";

let stop: (() => void) | undefined;
function api() {
  return {
    overview: vi.fn().mockResolvedValue(overview()),
    accounts: vi.fn().mockResolvedValue({ accounts: [], as_of: 1, revision: 1 }),
    capabilities: vi.fn().mockResolvedValue({ capabilities: [], as_of: 1 }),
    refresh: vi.fn().mockResolvedValue({ status: "queued", retry_after_ms: 15000 }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  vi.useFakeTimers();
  connectionStore.getState().setStatus("online");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

it("clears A data and rejects late reads across A → B → A even if transport ignores abort", async () => {
  const mock = api();
  const first = deferred<UsageOverview>(); const second = deferred<UsageOverview>(); const third = deferred<UsageOverview>();
  mock.overview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  selectDaemon("http://usage-a");
  const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption");
  const initialGeneration = daemonIdentity.getState().generation;
  selectDaemon("http://usage-b"); selectDaemon("http://usage-a");
  expect(daemonIdentity.getState().generation).toBe(initialGeneration + 2);
  first.resolve(overview({ revision: 10 })); second.resolve(overview({ revision: 20 })); await flush();
  expect(controller.store.getState().overview).toBeNull();
  third.resolve(overview({ revision: 30 })); await flush();
  expect(controller.store.getState().overview?.revision).toBe(30);
});

it("suspends hidden reads, reloads when visible, and stops all reads on close without backend mutations", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(600000);
  expect(mock.overview).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange")); await flush();
  expect(mock.overview).toHaveBeenCalledTimes(2);
  stop(); stop = undefined; await vi.advanceTimersByTimeAsync(600000);
  expect(mock.overview).toHaveBeenCalledTimes(2);
  expect(mock.refresh).not.toHaveBeenCalled();
});

it("reloads every five minutes and caches capabilities across panel mounts per daemon", async () => {
  selectDaemon("http://usage-idle-a");
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  await vi.advanceTimersByTimeAsync(299999);
  expect(mock.overview).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.overview).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(300000);
  expect(mock.overview).toHaveBeenCalledTimes(3);
  expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.capabilities).toHaveBeenCalledTimes(1);
  stop();
  stop = controller.mount(usageQuery, "accounts"); await flush();
  await vi.advanceTimersByTimeAsync(600000);
  expect(mock.accounts).toHaveBeenCalledTimes(3);
  expect(mock.capabilities).toHaveBeenCalledTimes(1);
  selectDaemon("http://usage-idle-b"); await flush();
  expect(mock.capabilities).toHaveBeenCalledTimes(2);
});

it("deduplicates revisions and coalesces in-flight updates without clearing the snapshot", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  const revision = controller.store.getState().overview!.revision;
  for (const value of [revision, revision - 1, NaN, 1.5, -1]) controller.invalidate(value);
  expect(mock.overview).toHaveBeenCalledTimes(1);
  const pending = deferred<UsageOverview>();
  mock.overview.mockReturnValueOnce(pending.promise);
  controller.invalidate(revision + 1);
  expect(controller.store.getState().loading).toBe(false);
  expect(controller.store.getState().changingInclusion).toBe(false);
  expect(controller.store.getState().overview?.revision).toBe(revision);
  controller.invalidate(revision + 2); controller.invalidate(revision + 3);
  expect(mock.overview).toHaveBeenCalledTimes(2);
  expect(mock.overview.mock.calls[1]?.[1].aborted).toBe(false);
  mock.overview.mockResolvedValue(overview({ revision: revision + 3 }));
  pending.resolve(overview({ revision: revision + 1 })); await flush();
  expect(mock.overview).toHaveBeenCalledTimes(3);
  expect(controller.store.getState().overview?.revision).toBe(revision + 3);
  controller.invalidate(revision + 3); await vi.advanceTimersByTimeAsync(60000);
  expect(mock.overview).toHaveBeenCalledTimes(3);
  expect(mock.capabilities).toHaveBeenCalledTimes(1);
});

it("does not loop when a response is behind the requested revision", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  controller.invalidate(100); await flush();
  controller.invalidate(100); await vi.advanceTimersByTimeAsync(60000);
  expect(mock.overview).toHaveBeenCalledTimes(2);
});

it("retains the last snapshot offline and reloads on reconnect", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  connectionStore.getState().setStatus("offline"); await vi.advanceTimersByTimeAsync(600000);
  expect(mock.overview).toHaveBeenCalledTimes(1);
  expect(controller.store.getState().overview).not.toBeNull();
  connectionStore.getState().setStatus("online"); await flush();
  expect(mock.overview).toHaveBeenCalledTimes(2);
});

it("rejects old filter reads and keeps accounts independently readable when capabilities fail", async () => {
  const mock = api(); const old = deferred<UsageOverview>(); mock.overview.mockReturnValueOnce(old.promise);
  mock.capabilities.mockRejectedValue(new Error("capability unavailable"));
  const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); stop();
  stop = controller.mount({ ...usageQuery, includeDeleted: false }, "accounts"); await flush();
  old.resolve(overview()); await flush();
  expect(controller.store.getState().overview).toBeNull();
  expect(controller.store.getState().accounts?.accounts).toEqual([]);
  expect(controller.store.getState().capabilityError).toBe("capability unavailable");
  expect(controller.store.getState().error).toBeNull();
});

it("refresh is explicit, coalesced, and cannot repopulate another daemon", async () => {
  const mock = api(); const pending = deferred<{ status: string; retry_after_ms: number }>(); mock.refresh.mockReturnValueOnce(pending.promise);
  const controller = createUsageStore(mock); stop = controller.mount(usageQuery, "consumption"); await flush();
  const refreshing = controller.refresh(); await controller.refresh();
  expect(mock.refresh).toHaveBeenCalledTimes(1);
  selectDaemon("http://usage-c"); await flush();
  pending.resolve({ status: "queued", retry_after_ms: 15000 }); await refreshing;
  expect(controller.store.getState().refreshStatus).toBeNull();
});

it("shows errors without converting retained or missing measurements to zero", async () => {
  const mock = api(); const controller = createUsageStore(mock); stop = controller.mount(usageQuery, "consumption"); await flush();
  mock.overview.mockRejectedValue(new Error("offline read")); controller.reload(); await flush();
  expect(controller.store.getState().overview?.summary.total_tokens).toBe(120);
  expect(controller.store.getState().error).toBe("offline read");
  mock.overview.mockRejectedValue(new Error("")); controller.reload(); await flush();
  expect(controller.store.getState().error).toBe("Request failed");
});

it("keeps refresh busy only while collection is running and permits immediate retries", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  const pending = deferred<{ status: string; retry_after_ms: number }>();
  mock.refresh.mockReturnValueOnce(pending.promise);
  const refreshing = controller.refresh();
  expect(controller.store.getState().refreshing).toBe(true);
  await controller.refresh();
  expect(mock.refresh).toHaveBeenCalledTimes(1);
  pending.resolve({ status: "completed", retry_after_ms: 0 });
  await refreshing;
  expect(controller.store.getState()).toMatchObject({ refreshing: false, refreshStatus: null });
  await controller.refresh();
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});

it("does not impose a cooldown or show an old daemon's cooldown notice", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "accounts"); await flush();
  mock.refresh.mockResolvedValue({ status: "cooldown", retry_after_ms: 15000 });
  await controller.refresh();
  expect(controller.store.getState()).toMatchObject({ refreshing: false, refreshStatus: null });
  await controller.refresh();
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});

it("keeps the last snapshot on filter changes and ignores obsolete filter responses", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  const previous = controller.store.getState().overview;
  const older = deferred<UsageOverview>(); const latest = deferred<UsageOverview>();
  mock.overview.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
  stop();
  stop = controller.mount({ ...usageQuery, includeDeleted: false, groupBy: "session" }, "consumption");
  expect(controller.store.getState()).toMatchObject({ overview: previous, overviewGroup: "model", loading: false, updating: true, changingInclusion: true });
  stop();
  stop = controller.mount({ ...usageQuery, includeDeleted: true, groupBy: "project" }, "consumption");
  older.resolve(overview({ revision: 50 })); await flush();
  expect(controller.store.getState().overview).toBe(previous);
  latest.resolve(overview({ revision: 51 })); await flush();
  expect(controller.store.getState()).toMatchObject({ overview: { revision: 51 }, overviewGroup: "project", updating: false, changingInclusion: false });
});

it("does not keep a snapshot from a different scope", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush(); stop();
  mock.overview.mockReturnValueOnce(deferred<UsageOverview>().promise);
  stop = controller.mount({ ...usageQuery, scope: { kind: "session", id: "another-session" } }, "consumption");
  expect(controller.store.getState().overview).toBeNull();
  expect(controller.store.getState().loading).toBe(true);
});

it("only masks metrics for the deleted-session toggle, not other filters or manual refresh", async () => {
  const mock = api(); const controller = createUsageStore(mock);
  stop = controller.mount(usageQuery, "consumption"); await flush();
  const next = deferred<UsageOverview>();
  mock.overview.mockReturnValueOnce(next.promise);
  stop();
  stop = controller.mount({ ...usageQuery, period: "lifetime", includeDescendants: false }, "consumption");
  expect(controller.store.getState()).toMatchObject({ updating: true, changingInclusion: false });
  next.resolve(overview()); await flush();
  mock.overview.mockReturnValueOnce(deferred<UsageOverview>().promise);
  void controller.refresh(); await flush();
  expect(controller.store.getState()).toMatchObject({ updating: true, changingInclusion: false });
});
