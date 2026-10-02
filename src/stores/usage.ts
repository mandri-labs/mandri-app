import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import { cachedUsageCapabilities } from "@/daemon/usageCapabilities";
import { connectionStore } from "./connection";
import {
  usageApi,
  type UsageAccounts,
  type UsageCapabilities,
  type UsageOverview,
  type UsageQuery,
} from "@/daemon/rest/usage";

interface UsageState {
  overview: UsageOverview | null;
  overviewGroup: UsageQuery["groupBy"];
  updating: boolean;
  changingInclusion: boolean;
  accounts: UsageAccounts | null;
  capabilities: UsageCapabilities | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  capabilityError: string | null;
  refreshStatus: string | null;
}
const empty = (): UsageState => ({
  overview: null,
  overviewGroup: "model",
  updating: false,
  changingInclusion: false,
  accounts: null,
  capabilities: null,
  loading: false,
  refreshing: false,
  error: null,
  capabilityError: null,
  refreshStatus: null,
});
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)) || "Request failed";

// Owned by the mounted panel: disposing reads never controls daemon collection.
export function createUsageStore(api = usageApi) {
  const store = createStore<UsageState>(() => empty());
  let reload = () => {};
  let invalidate = (_revision: number) => {};
  let enqueue = async () => {};
  let mountedScope = "";
  let mountedGeneration = -1;
  let mountedIncludeDeleted: boolean | undefined;
  function mount(query: UsageQuery, tab: "consumption" | "accounts") {
    const scope = JSON.stringify(query.scope);
    const generation = daemonIdentity.getState().generation;
    const preserve = scope === mountedScope && generation === mountedGeneration;
    const changingInclusion =
      preserve &&
      tab === "consumption" &&
      store.getState().overview !== null &&
      mountedIncludeDeleted !== query.includeDeleted;
    mountedScope = scope;
    mountedGeneration = generation;
    mountedIncludeDeleted = query.includeDeleted;
    let disposed = false;
    let serial = 0;
    let read: AbortController | null = null;
    let refresh: AbortController | null = null;
    let wantedRevision = -1;
    let reloadPending = false;
    let invalidationTimer: ReturnType<typeof setTimeout> | undefined;
    const snapshot = () =>
      tab === "consumption" ? store.getState().overview : store.getState().accounts;
    const visible = () =>
      document.visibilityState !== "hidden" && connectionStore.getState().status === "online";
    const finishRefresh = () => {
      store.setState({ refreshing: false });
    };
    const cancel = () => {
      clearTimeout(invalidationTimer);
      invalidationTimer = undefined;
      serial++;
      read?.abort();
      read = null;
      reloadPending = false;
    };
    const load = async () => {
      if (disposed || !visible()) return;
      if (read) {
        reloadPending = true;
        return;
      }
      clearTimeout(invalidationTimer);
      invalidationTimer = undefined;
      const ticket = ++serial;
      const requestedRevision = wantedRevision;
      const generation = daemonIdentity.getState().generation;
      const controller = new AbortController();
      read = controller;
      const current = () =>
        !disposed &&
        ticket === serial &&
        generation === daemonIdentity.getState().generation &&
        !controller.signal.aborted;
      store.setState({ loading: snapshot() === null, updating: true, error: null });
      try {
        if (tab === "consumption") {
          const result = await api.overview(query, controller.signal);
          if (current()) store.setState({ overview: result, overviewGroup: query.groupBy });
        } else {
          const result = await api.accounts(controller.signal);
          if (current()) store.setState({ accounts: result });
        }
      } catch (error) {
        if (current()) store.setState({ error: message(error) });
      } finally {
        if (current()) {
          read = null;
          store.setState({ loading: false, updating: false, changingInclusion: false });
          const again =
            reloadPending ||
            wantedRevision > Math.max(requestedRevision, snapshot()?.revision ?? -1);
          reloadPending = false;
          if (again) scheduleInvalidation();
        }
      }
    };
    const scheduleInvalidation = () => {
      if (disposed || !visible() || read || invalidationTimer !== undefined) return;
      invalidationTimer = setTimeout(() => {
        invalidationTimer = undefined;
        void load();
      }, 2000);
    };
    const capabilities = () => {
      if (!visible()) return;
      const generation = daemonIdentity.getState().generation;
      void cachedUsageCapabilities(api).then(
        (value) => {
          if (!disposed && generation === daemonIdentity.getState().generation)
            store.setState({ capabilities: value, capabilityError: null });
        },
        (error: unknown) => {
          if (!disposed && generation === daemonIdentity.getState().generation)
            store.setState({ capabilityError: message(error) });
        },
      );
    };
    // Keep the mounted view during filter changes; never reuse another scope/daemon.
    store.setState(
      preserve
        ? {
            loading: false,
            updating: false,
            changingInclusion: changingInclusion && visible(),
            refreshing: false,
            error: null,
            refreshStatus: null,
          }
        : empty(),
    );
    const unsubscribeDaemon = daemonIdentity.subscribe((next, previous) => {
      if (next.generation === previous.generation) return;
      cancel();
      refresh?.abort();
      refresh = null;
      finishRefresh();
      wantedRevision = -1;
      mountedGeneration = next.generation;
      store.setState(empty());
      capabilities();
      void load();
    });
    const visibility = () => {
      cancel();
      if (!visible()) {
        refresh?.abort();
        refresh = null;
        finishRefresh();
      }
      store.setState({ loading: false, updating: false, changingInclusion: false });
      if (visible()) {
        capabilities();
        void load();
      }
    };
    const unsubscribeConnection = connectionStore.subscribe((next, previous) => {
      if (next.status !== previous.status) visibility();
    });
    document.addEventListener("visibilitychange", visibility);
    reload = () => {
      void load();
    };
    invalidate = (revision) => {
      if (
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision <= Math.max(wantedRevision, snapshot()?.revision ?? -1)
      )
        return;
      wantedRevision = revision;
      scheduleInvalidation();
    };
    enqueue = async () => {
      if (disposed || !visible() || refresh) return;
      const controller = new AbortController();
      refresh = controller;
      const generation = daemonIdentity.getState().generation;
      store.setState({ refreshing: true, refreshStatus: null });
      try {
        const result = await api.refresh(controller.signal);
        if (
          !disposed &&
          !controller.signal.aborted &&
          generation === daemonIdentity.getState().generation
        ) {
          store.setState({ refreshStatus: result.status === "unavailable" ? result.status : null });
          await load();
        }
      } catch (error) {
        if (
          !disposed &&
          !controller.signal.aborted &&
          generation === daemonIdentity.getState().generation
        )
          store.setState({ error: message(error) });
      } finally {
        if (refresh === controller) {
          refresh = null;
          finishRefresh();
        }
      }
    };
    capabilities();
    void load();
    const poll = setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      disposed = true;
      cancel();
      refresh?.abort();
      refresh = null;
      clearInterval(poll);
      finishRefresh();
      unsubscribeDaemon();
      unsubscribeConnection();
      document.removeEventListener("visibilitychange", visibility);
      reload = () => {};
      invalidate = () => {};
      enqueue = async () => {};
    };
  }
  return {
    store,
    mount,
    reload: () => reload(),
    invalidate: (revision: number) => invalidate(revision),
    refresh: () => enqueue(),
  };
}
