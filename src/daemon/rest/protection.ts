import { request, type CallOptions } from "./client";
import type { components } from "../types/rest.gen";
import type { PolicyRequest } from "../protection";

export interface ExecutionStatus extends PolicyRequest {
  session_id: string;
  policy_revision: number;
  generation: number;
  revision: number;
  phase: string;
  effective_binding: boolean;
  reason?: string | null;
}

export function getExecutionStatus(id: string): Promise<ExecutionStatus> {
  return request(`/v1/runtime/sessions/${encodeURIComponent(id)}/execution`);
}

export function forkSession(
  id: string,
  body: components["schemas"]["SessionForkIn"],
  options?: CallOptions,
): Promise<components["schemas"]["RuntimeSessionOut"]> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/fork`, {
    method: "POST",
    timeoutMs: null,
    body,
    ...options,
  });
}
