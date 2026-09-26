import { useEffect } from "react";
import { useStore } from "@/app/useStore";
import { getSessionAvailability, type SessionAvailability } from "@/daemon/rest/availability";
import { daemonIdentity } from "@/daemon/identity";
import { connectionStore } from "@/stores/connection";
import { sessionsStore } from "@/stores/sessions";

const pending = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();

export function applyAvailability(id: string, availability: SessionAvailability): void {
  if (availability.owner === "unknown") return;
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  sessionsStore.getState().applySessionPatch(id, { availability });
}

export function refreshAvailability(id: string): Promise<void> {
  const generation = daemonIdentity.getState().generation;
  const key = `${generation}:${id}`;
  const revision = revisions.get(id) ?? 0;
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = getSessionAvailability(id)
    .then((value) => {
      if (!value || !["mandri", "external", "unowned", "unknown"].includes(value.owner))
        throw new Error("Invalid availability response");
      if (
        generation === daemonIdentity.getState().generation &&
        revision === (revisions.get(id) ?? 0)
      )
        applyAvailability(id, value);
    })
    .catch(() => undefined)
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
    void refreshAvailability(id);
    const timer = setInterval(() => {
      void refreshAvailability(id);
    }, 5000);
    return () => clearInterval(timer);
  }, [id, enabled, status, generation, lifecycle]);
}
