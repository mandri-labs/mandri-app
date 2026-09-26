export interface DaemonEndpoint {
  id: string;
  name: string;
  url: string;
}

export const LOCAL_ENDPOINT: DaemonEndpoint = {
  id: "local",
  name: "Local",
  url: "http://127.0.0.1:8787",
};

export function normalizeEndpointUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Preserve the old single address when upgrading to named endpoints. */
export function restoreEndpoints(stored: {
  endpoints?: DaemonEndpoint[];
  selectedEndpointId?: string;
  daemonBaseUrl?: string;
}) {
  const endpoints = [LOCAL_ENDPOINT];
  for (const entry of Array.isArray(stored.endpoints) ? stored.endpoints : []) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.url !== "string"
    )
      continue;
    const url = normalizeEndpointUrl(entry.url);
    if (
      !entry.id ||
      !entry.name.trim() ||
      !url ||
      endpoints.some((row) => row.id === entry.id || row.url === url)
    )
      continue;
    endpoints.push({ id: entry.id, name: entry.name.trim(), url });
  }
  let selected = endpoints.find((entry) => entry.id === stored.selectedEndpointId);
  if (!selected && !stored.selectedEndpointId && typeof stored.daemonBaseUrl === "string") {
    const url = normalizeEndpointUrl(stored.daemonBaseUrl);
    if (url) {
      selected = endpoints.find((entry) => entry.url === url);
      if (!selected) {
        let id = "imported";
        while (endpoints.some((entry) => entry.id === id)) id += "-endpoint";
        selected = { id, name: new URL(url).host, url };
        endpoints.push(selected);
      }
    }
  }
  selected ??= LOCAL_ENDPOINT;
  return { endpoints, selectedEndpointId: selected.id, daemonBaseUrl: selected.url };
}
