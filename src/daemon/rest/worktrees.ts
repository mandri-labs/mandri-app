import { request } from "./client";
import type { components } from "../types/rest.gen";

export type IntegrationPreview = components["schemas"]["IntegrationPreview"];
export type IntegrationStrategy = "squash" | "merge";
type SessionOut = components["schemas"]["SessionOut"];

const path = (id: string) => `/v1/sessions/${encodeURIComponent(id)}/worktree`;

export function previewIntegration(
  id: string,
  target?: string,
  strategy: IntegrationStrategy = "squash",
) {
  return request<IntegrationPreview>(`${path(id)}/integration`, { query: { target, strategy } });
}

export function integrateWorktree(id: string, review: IntegrationPreview, message: string) {
  return request<SessionOut>(`${path(id)}/integration`, {
    method: "POST",
    body: { target: review.target, token: review.token, strategy: review.strategy, message },
  });
}

export function resolveWorktree(id: string, review: IntegrationPreview) {
  return request<void>(`${path(id)}/resolve`, {
    method: "POST",
    body: { target: review.target, token: review.token, strategy: review.strategy },
  });
}

export function finishWorktree(id: string) {
  return request<SessionOut>(`${path(id)}/finish`, { method: "POST" });
}
