import type { components } from "@/daemon/types/rest.gen";

type Runtime = components["schemas"]["RuntimeOut"];

/** Resolve the same usable default in settings and the new-session composer. */
export function resolveDefaultHarness(runtimes: Runtime[], preferred?: string): string {
  const available = runtimes.filter((runtime) => runtime.installed && !runtime.degraded);
  return (
    (available.find((runtime) => runtime.harness === preferred) ?? available[0])?.harness ?? ""
  );
}
