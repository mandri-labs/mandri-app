import { daemonIdentity } from "./identity";
import { usageApi, type UsageCapabilities } from "./rest/usage";

const caches = new WeakMap<
  typeof usageApi.capabilities,
  Map<
    string,
    {
      expires: number;
      promise: Promise<UsageCapabilities>;
    }
  >
>();

export function cachedUsageCapabilities(api = usageApi): Promise<UsageCapabilities> {
  let cache = caches.get(api.capabilities);
  if (!cache) {
    cache = new Map();
    caches.set(api.capabilities, cache);
  }
  const key = daemonIdentity.getState().baseUrl;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  const entry = {
    expires: Date.now() + 60 * 60 * 1000,
    promise: api.capabilities(new AbortController().signal),
  };
  entry.promise = entry.promise.catch((error: unknown) => {
    entry.expires = Date.now() + 60 * 1000;
    throw error;
  });
  cache.set(key, entry);
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  return entry.promise;
}
