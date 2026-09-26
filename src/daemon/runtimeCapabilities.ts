import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "@/app/useStore";
import { daemonIdentity } from "./identity";
import { request } from "./rest/client";

export interface RuntimeCapabilities {
  modelSources?: string[];
  steering?: string;
  inputTypes?: string[];
  permissionModes?: string[];
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

export function parseRuntimeCapabilities(value: unknown): RuntimeCapabilities | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return { modelSources: strings(record.model_sources), inputTypes: strings(record.input_types),
    permissionModes: strings(record.permission_modes), steering: typeof record.steering === "string" ? record.steering : undefined };
}

export const runtimeCapabilitiesStore = createStore<{ entries: Record<string, RuntimeCapabilities | undefined> }>(() => ({ entries: {} }));
let pending: Promise<void> | undefined;
let revision = 0;

export function rememberRuntimeCapabilities(rows: { harness: string; capabilities?: unknown }[]): void {
  runtimeCapabilitiesStore.setState({ entries: Object.fromEntries(rows.map((row) => [row.harness, parseRuntimeCapabilities(row.capabilities)])) });
}

daemonIdentity.subscribe(() => {
  revision += 1;
  pending = undefined;
  runtimeCapabilitiesStore.setState({ entries: {} });
});

function loadCapabilities(): Promise<void> {
  if (pending) return pending;
  const started = revision;
  const promise = request<{ harness: string; capabilities?: unknown }[]>("/v1/runtimes")
    .then((rows) => { if (started === revision) rememberRuntimeCapabilities(rows); })
    .catch(() => undefined)
    .finally(() => { if (pending === promise) pending = undefined; });
  pending = promise;
  return promise;
}

export function useRuntimeCapabilities(harness?: string, load = false): RuntimeCapabilities | undefined {
  const entry = useStore(runtimeCapabilitiesStore, (state) => harness ? state.entries[harness] : undefined);
  const known = useStore(runtimeCapabilitiesStore, (state) => harness ? harness in state.entries : true);
  useEffect(() => { if (load && harness && !known) void loadCapabilities(); }, [load, harness, known]);
  return entry;
}
