import { rememberRuntimeCapabilities } from "../runtimeCapabilities";
import { daemonIdentity } from "../identity";
import { request, type CallOptions, type GetOptions } from "./client";
import type { components } from "../types/rest.gen";

type RuntimeOut = components["schemas"]["RuntimeOut"];
type RuntimeSessionOut = components["schemas"]["RuntimeSessionOut"];
type RuntimeStartIn = components["schemas"]["RuntimeStartIn"];

export async function startSession(
  body: RuntimeStartIn,
  options?: CallOptions,
): Promise<RuntimeSessionOut> {
  return request<RuntimeSessionOut>("/v1/runtime/sessions", {
    method: "POST",
    timeoutMs: null,
    body,
    ...options,
  });
}

export async function stopSession(sessionId: string, options?: CallOptions): Promise<void> {
  return request<void>(`/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    ...options,
  });
}

export async function resumeSession(
  sessionId: string,
  options?: CallOptions,
  mode?: string,
): Promise<RuntimeSessionOut> {
  return request<RuntimeSessionOut>(`/v1/sessions/${encodeURIComponent(sessionId)}/resume`, {
    method: "POST",
    timeoutMs: null,
    ...(mode === undefined ? {} : { body: { mode } }),
    ...options,
  });
}

export async function listRuntimes(options?: GetOptions): Promise<RuntimeOut[]> {
  const generation = daemonIdentity.getState().generation;
  const rows = await request<RuntimeOut[]>("/v1/runtimes", { ...options });
  if (generation === daemonIdentity.getState().generation) rememberRuntimeCapabilities(rows);
  return rows;
}

export function cancelStartup(operationId: string): Promise<void> {
  return request(`/v1/runtime/operations/${encodeURIComponent(operationId)}/cancel`, {
    method: "POST",
    timeoutMs: null,
  });
}
