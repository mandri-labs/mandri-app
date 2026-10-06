import { request } from "./client";
import type { components } from "../types/rest.gen";

// Keep HTTP query encoding and account snapshot shapes at the REST boundary.
export type UsageScope =
  { kind: "global" } | { kind: "project"; id: string } | { kind: "session"; id: string };
export type UsageGroup = "model" | "session" | "project";
export interface UsageQuery {
  scope: UsageScope;
  period: "last30d" | "lifetime";
  includeDeleted: boolean;
  includeDescendants: boolean;
  groupBy: UsageGroup;
  timezone: string;
}
export type UsageMetrics = components["schemas"]["UsageMetricsOut"];
export type UsageOverview = components["schemas"]["UsageOverviewOut"];
export type UsageAccount = components["schemas"]["UsageAccountOut"];
export type UsageAccounts = components["schemas"]["UsageAccountsOut"];
export type UsageCapabilities = components["schemas"]["UsageCapabilitiesOut"];

export function usageParams(query: UsageQuery, now = new Date()) {
  return {
    session_id: query.scope.kind === "session" ? query.scope.id : undefined,
    project_path: query.scope.kind === "project" ? query.scope.id : undefined,
    from_ms: query.period === "last30d" ? now.getTime() - 30 * 86400000 : undefined,
    to_ms: query.period === "last30d" ? now.getTime() : undefined,
    timezone: query.timezone,
    include_deleted: query.includeDeleted,
    include_descendants: query.includeDescendants,
    group_by: query.groupBy,
  };
}
export const usageApi = {
  overview: (query: UsageQuery, signal: AbortSignal) =>
    request<UsageOverview>("/v1/usage/overview", { query: usageParams(query), signal }),
  accounts: (signal: AbortSignal) => request<UsageAccounts>("/v1/usage/accounts", { signal }),
  capabilities: (signal: AbortSignal) =>
    request<UsageCapabilities>("/v1/usage/capabilities", { signal }),
  refresh: (signal: AbortSignal) =>
    request<components["schemas"]["UsageRefreshOut"]>("/v1/usage/refresh", {
      method: "POST",
      signal,
      timeoutMs: 45000,
    }),
};

export const eraseSessionUsage = (sessionId: string, signal: AbortSignal) =>
  request<components["schemas"]["UsageEraseOut"]>(
    `/v1/usage/sessions/${encodeURIComponent(sessionId)}/erase`,
    { method: "POST", body: { confirmed: true }, signal },
  );
