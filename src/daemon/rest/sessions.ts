import { modelSelection } from "../modelSelection";
import { request, type CallOptions, type GetOptions } from "./client";
import type { components } from "../types/rest.gen";

type SessionOut = components["schemas"]["SessionOut"];

export type SessionListFilters = {
  harness?: string | null;
  state?: string | null;
  project_path?: string | null;
};

export async function listSessions(
  filters?: SessionListFilters,
  options?: GetOptions,
): Promise<SessionOut[]> {
  return request<SessionOut[]>("/v1/sessions", { query: filters, ...options });
}

export async function getSession(sessionId: string, options?: GetOptions): Promise<SessionOut> {
  return request<SessionOut>(`/v1/sessions/${encodeURIComponent(sessionId)}`, { ...options });
}

export async function renameSession(
  sessionId: string,
  title: string,
  options?: CallOptions,
): Promise<SessionOut> {
  return request<SessionOut>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: { title },
    ...options,
  });
}

export async function deleteSession(
  sessionId: string,
  purge?: boolean,
  options?: CallOptions,
  discardWorktree?: boolean,
): Promise<void> {
  return request<void>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    query: {
      ...(purge === undefined ? {} : { purge }),
      ...(discardWorktree ? { discard_worktree: true } : {}),
    },
    ...options,
  });
}

export async function setSessionModel(
  sessionId: string,
  model: string,
  options?: CallOptions,
): Promise<SessionOut> {
  return request<SessionOut>(`/v1/sessions/${encodeURIComponent(sessionId)}/model`, {
    method: "PATCH",
    body: modelSelection(model),
    ...options,
  });
}

export async function setSessionEffort(
  sessionId: string,
  effort: string | null,
  options?: CallOptions,
): Promise<SessionOut> {
  return request<SessionOut>(`/v1/runtime/sessions/${encodeURIComponent(sessionId)}/effort`, {
    method: "PATCH",
    body: { effort },
    ...options,
  });
}

export function renameWorktree(sessionId: string, id: string): Promise<SessionOut> {
  return request(`/v1/sessions/${encodeURIComponent(sessionId)}/worktree`, {
    method: "PATCH",
    body: { id },
  });
}

export type SessionPrivacy = components["schemas"]["SessionPrivacyOut"];

export function getSessionPrivacy(
  sessionId: string,
  options?: GetOptions,
): Promise<SessionPrivacy> {
  return request(`/v1/sessions/${encodeURIComponent(sessionId)}/privacy`, { ...options });
}
