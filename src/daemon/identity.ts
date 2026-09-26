import { createStore } from "zustand/vanilla";

// A generation also distinguishes A -> B -> A while requests are still in flight.
export const daemonIdentity = createStore(() => ({
  baseUrl: "http://127.0.0.1:8787",
  generation: 0,
}));

export function selectDaemon(baseUrl: string): void {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const current = daemonIdentity.getState();
  if (current.baseUrl !== normalized) {
    daemonIdentity.setState({ baseUrl: normalized, generation: current.generation + 1 });
  }
}
