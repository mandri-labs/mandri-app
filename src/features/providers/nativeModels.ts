import { useEffect, useMemo } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "@/app/useStore";
import { useRuntimeCapabilities } from "@/daemon/runtimeCapabilities";
import { request } from "@/daemon/rest/client";
import { daemonIdentity } from "@/daemon/identity";
import { providersStore, type ProviderView, type ModelCatalogEntry } from "@/stores/providers";

type NativeCatalog = {
  models: ModelCatalogEntry[];
  state: "loading" | "loaded" | "unavailable";
  expires?: number;
};
export const nativeModelsStore = createStore<{ catalogs: Record<string, NativeCatalog> }>(() => ({
  catalogs: {},
}));
const pending = new Map<string, Promise<void>>();
let revision = 0;
const FRESH_MS = 60_000;

export function invalidateNativeModels(): void {
  revision += 1;
  pending.clear();
  nativeModelsStore.setState({ catalogs: {} });
}

daemonIdentity.subscribe(invalidateNativeModels);

export function loadNativeModels(harness: string, cwd?: string): Promise<void> {
  const key = `${harness}:${cwd ?? ""}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const cached = nativeModelsStore.getState().catalogs[key];
  if (cached?.state === "loaded" && (cached.expires ?? 0) > Date.now()) return Promise.resolve();
  const startedRevision = revision;
  const update = (catalog: NativeCatalog) => {
    if (revision !== startedRevision) return;
    nativeModelsStore.setState((state) => ({ catalogs: { ...state.catalogs, [key]: catalog } }));
  };
  update({ models: nativeModelsStore.getState().catalogs[key]?.models ?? [], state: "loading" });
  const promise = request<ModelCatalogEntry[]>(
    `/v1/runtimes/${encodeURIComponent(harness)}/models`,
    {
      query: cwd ? { cwd } : undefined,
      timeoutMs: 25000,
    },
  )
    .then((models) => update({ models, state: "loaded", expires: Date.now() + FRESH_MS }))
    .catch(() => update({ models: [], state: "unavailable" }))
    .finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}

export function useModelProviders(
  harness?: string,
  cwd?: string,
  load = false,
  allowNative = true,
): Record<string, ProviderView> {
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const providers = useStore(providersStore, (state) => state.providers);
  const catalog = useStore(nativeModelsStore, (state) => state.catalogs[`${harness}:${cwd ?? ""}`]);
  const capabilities = useRuntimeCapabilities(harness, load);
  const native = allowNative && capabilities?.modelSources?.includes("native") === true;
  const catalogMissing = catalog === undefined;
  useEffect(() => {
    if (native && load && harness) void loadNativeModels(harness, cwd);
  }, [native, load, harness, cwd, generation, catalogMissing]);
  return useMemo(() => {
    const gateway =
      capabilities?.modelSources && !capabilities.modelSources.includes("gateway")
        ? {}
        : Object.fromEntries(
            Object.entries(providers).filter(([, provider]) => provider.enabled !== false),
          );
    if (!native) return gateway;
    const models = catalog?.models ?? [];
    return {
      [`native:${harness}`]: {
        name: `native:${harness}`,
        kind: "native",
        state: "unverified",
        catalogState: catalog?.state ?? "loading",
        modelCatalog: models.some((model) => model.id === "default")
          ? models
          : [{ id: "default", reasoning_efforts: [], default_effort: null }, ...models],
      },
      ...gateway,
    };
  }, [native, harness, catalog, providers, capabilities]);
}
