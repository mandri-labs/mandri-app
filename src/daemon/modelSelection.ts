export function nativeHarness(ref: string): string | undefined {
  return /^native:([^/:\s]+)\/.+/.exec(ref)?.[1];
}

export function modelSelection(ref: string): { model: string; model_source: "native" | "gateway" } {
  return nativeHarness(ref)
    ? { model: ref.slice(ref.indexOf("/") + 1), model_source: "native" }
    : { model: ref, model_source: "gateway" };
}

export function sessionModelRef(session: {
  model?: string | null;
  model_source?: string | null;
  harness: string;
}): string | undefined {
  if (session.model_source === "native")
    return `native:${session.harness}/${session.model || "default"}`;
  return session.model || undefined;
}
