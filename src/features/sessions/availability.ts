import { useEffect } from "react";
import { useStore } from "@/app/useStore";
import { getSessionAvailability, type SessionAvailability } from "@/daemon/rest/availability";
import { daemonIdentity } from "@/daemon/identity";
import { connectionStore } from "@/stores/connection";
import { sessionsStore } from "@/stores/sessions";

const pending = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();
const retries = new Map<string, { failures: number; nextAt: number }>();

daemonIdentity.subscribe((state, previous) => {
  if (state.generation !== previous.generation) {
    retries.clear();
    revisions.clear();
  }
});

export function applyAvailability(id: string, availability: SessionAvailability): void {
  if (availability.owner === "unknown") return;
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  sessionsStore.getState().applySessionPatch(id, { availability });
}

export function refreshAvailability(id: string, polling = false): Promise<void> {
  const generation = daemonIdentity.getState().generation;
  const key = `${generation}:${id}`;
  const revision = revisions.get(id) ?? 0;
  const existing = pending.get(key);
  if (existing) return existing;
  if (polling && Date.now() < (retries.get(key)?.nextAt ?? 0)) return Promise.resolve();
  const promise = getSessionAvailability(id)
    .then((value) => {
      if (!value || !["mandri", "external", "unowned", "unknown"].includes(value.owner))
        throw new Error("Invalid availability response");
      if (value.owner === "unknown") throw new Error("Availability is inconclusive");
      if (generation === daemonIdentity.getState().generation)
        retries.set(key, { failures: 0, nextAt: Date.now() + 5000 });
      if (
        generation === daemonIdentity.getState().generation &&
        revision === (revisions.get(id) ?? 0)
      )
        applyAvailability(id, value);
    })
    .catch(() => {
      if (generation !== daemonIdentity.getState().generation) return;
      const failures = Math.min((retries.get(key)?.failures ?? 0) + 1, 4);
      retries.set(key, { failures, nextAt: Date.now() + Math.min(5000 * 2 ** failures, 60000) });
    })
    .finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}

export function useSessionAvailability(id: string, enabled = true): void {
  const status = useStore(connectionStore, (state) => state.status);
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const lifecycle = useStore(sessionsStore, (state) => state.sessions[id]?.state);
  useEffect(() => {
    if (!enabled || status !== "online") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState !== "hidden") await refreshAvailability(id, true);
      if (stopped) return;
      const delay = Math.max(5000, (retries.get(`${generation}:${id}`)?.nextAt ?? 0) - Date.now());
      timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, enabled, status, generation, lifecycle]);
}
