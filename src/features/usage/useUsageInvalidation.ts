import { useEffect } from "react";
import { getDaemonSocket } from "@/app/connection";
import { registerIngest } from "@/app/framePipeline";
import { useStore } from "@/app/useStore";
import { daemonIdentity } from "@/daemon/identity";
import { connectionStore } from "@/stores/connection";

/** Subscribe only to durable usage revisions; the daemon owns source collection. */
export function useUsageInvalidation(invalidate: (revision: number) => void) {
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const status = useStore(connectionStore, (state) => state.status);
  useEffect(() => {
    if (status !== "online") return;
    const socket = getDaemonSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = -1;
    const visibility = () => {
      clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === "hidden") socket?.unsubscribe("usage.changed");
      else socket?.subscribe("usage.changed");
    };
    visibility();
    const unregister = registerIngest((frame) => {
      if (
        !("topic" in frame) ||
        frame.topic !== "usage.changed" ||
        document.visibilityState === "hidden" ||
        !("raw" in frame)
      )
        return;
      const raw = frame.raw;
      if (
        raw === null ||
        typeof raw !== "object" ||
        !("revision" in raw) ||
        typeof raw.revision !== "number" ||
        !Number.isSafeInteger(raw.revision) ||
        raw.revision < 0 ||
        raw.revision <= revision
      )
        return;
      revision = raw.revision;
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          invalidate(revision);
        }, 200);
    });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer);
      unregister();
      socket?.unsubscribe("usage.changed");
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [generation, status, invalidate]);
}
