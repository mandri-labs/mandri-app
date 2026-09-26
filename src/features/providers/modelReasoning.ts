import type { ModelCatalogEntry, ProviderView } from "@/stores/providers";

export function modelCatalogEntry(providers: Record<string, ProviderView>, modelRef: string): ModelCatalogEntry | undefined {
  const separator = modelRef.indexOf("/");
  if (separator < 0) return undefined;
  const provider = providers[modelRef.slice(0, separator)];
  if (provider?.catalogState !== "loaded") return undefined;
  return provider.modelCatalog?.find((entry) => entry.id === modelRef.slice(separator + 1));
}

export function supportedModelEffort(model: ModelCatalogEntry | undefined, effort: string | null | undefined): string | null {
  return effort && model?.reasoning_efforts.includes(effort) ? effort : null;
}
