import { daemonIdentity } from "@/daemon/identity";
import { DaemonError } from "@/daemon/errors";

const pending = new Map<string, Promise<unknown>>();

export function queueSessionModelChange<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const generation = daemonIdentity.getState().generation;
  const key = `${generation}:${sessionId}`;
  const previous = pending.get(key) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined)
    .then(() => {
      if (generation !== daemonIdentity.getState().generation) {
        throw new DaemonError({
          code: "service_unavailable",
          message: "Daemon changed before operation",
        });
      }
      return operation();
    });
  pending.set(key, result);
  const cleanup = () => {
    if (pending.get(key) === result) pending.delete(key);
  };
  void result.then(cleanup, cleanup);
  return result;
}
