import { getBaseUrl, request, type CallOptions, type GetOptions } from "./client";
import type { components } from "../types/rest.gen";
import { daemonIdentity } from "../identity";

type ProviderIn = components["schemas"]["ProviderIn"];
type ProviderOut = components["schemas"]["ProviderOut"];
type ProviderUpdateIn = components["schemas"]["ProviderUpdateIn"];
type ModelOut = components["schemas"]["ModelOut"];

const PROVIDERS_FRESH_MS = 60_000;
let cachedProviders: { base: string; rows: ProviderOut[]; expires: number } | undefined;
let pendingProviders: { base: string; promise: Promise<ProviderOut[]> } | undefined;
let providersRevision = 0;

export function invalidateProviders(): void {
  providersRevision += 1;
  cachedProviders = undefined;
  pendingProviders = undefined;
}

daemonIdentity.subscribe(invalidateProviders);

export async function listProviders(options?: GetOptions): Promise<ProviderOut[]> {
  // Requests with caller-owned cancellation/retry retain their independent lifecycle.
  if (options?.signal || options?.shouldRetry)
    return request<ProviderOut[]>("/v1/providers", options);
  const base = getBaseUrl();
  if (cachedProviders?.base === base && cachedProviders.expires > Date.now())
    return cachedProviders.rows;
  if (pendingProviders?.base === base) return pendingProviders.promise;
  const revision = providersRevision;
  const promise = request<ProviderOut[]>("/v1/providers")
    .then((rows) => {
      if (revision === providersRevision)
        cachedProviders = { base, rows, expires: Date.now() + PROVIDERS_FRESH_MS };
      return rows;
    })
    .finally(() => {
      if (pendingProviders?.promise === promise) pendingProviders = undefined;
    });
  pendingProviders = { base, promise };
  return promise;
}

async function mutateProviders<T>(operation: () => Promise<T>): Promise<T> {
  invalidateProviders();
  try {
    return await operation();
  } finally {
    invalidateProviders();
  }
}

export async function createProvider(
  body: ProviderIn,
  options?: CallOptions,
): Promise<ProviderOut> {
  return mutateProviders(() =>
    request<ProviderOut>("/v1/providers", {
      method: "POST",
      body,
      ...options,
    }),
  );
}

export async function updateProvider(
  name: string,
  body: ProviderUpdateIn,
  options?: CallOptions,
): Promise<ProviderOut> {
  return mutateProviders(() =>
    request<ProviderOut>(`/v1/providers/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body,
      ...options,
    }),
  );
}

export async function deleteProvider(name: string, options?: CallOptions): Promise<void> {
  return mutateProviders(() =>
    request<void>(`/v1/providers/${encodeURIComponent(name)}`, {
      method: "DELETE",
      ...options,
    }),
  );
}

export async function verifyProvider(name: string, options?: CallOptions): Promise<ProviderOut> {
  return mutateProviders(() =>
    request<ProviderOut>(`/v1/providers/${encodeURIComponent(name)}/verify`, {
      method: "POST",
      ...options,
    }),
  );
}

export async function listProviderModels(name: string, options?: GetOptions): Promise<ModelOut[]> {
  return request<ModelOut[]>(`/v1/providers/${encodeURIComponent(name)}/models`, {
    timeoutMs: 20_000,
    ...options,
  });
}
