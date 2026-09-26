import type { UsageMetrics, UsageOverview, UsageQuery } from "@/daemon/rest/usage";

export const usageQuery: UsageQuery = {
  scope: { kind: "global" },
  period: "last30d",
  includeDeleted: true,
  includeDescendants: true,
  groupBy: "model",
  timezone: "Europe/Paris",
};
export function metrics(patch: Partial<UsageMetrics> = {}): UsageMetrics {
  return {
    fact_count: 1,
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
    total_tokens: 120,
    request_count: 1,
    usd_equivalent: "0.00292",
    reported_cost_usd: null,
    missing_fields: {},
    unpriced_fact_count: 0,
    incomplete_fact_count: 0,
    unclassified_fact_count: 0,
    valuation_bases: {},
    unpriced_reasons: {},
    ...patch,
  };
}
export function overview(patch: Partial<UsageOverview> = {}): UsageOverview {
  return {
    revision: 1,
    as_of: 1789900000000,
    timezone: "Europe/Paris",
    summary: metrics(),
    timeseries: [{ date: "2026-09-20", ...metrics() }],
    breakdown: [{ key: "example-model", ...metrics() }],
    breakdown_total: 1,
    undated: metrics({ fact_count: 0 }),
    unallocated: metrics({ fact_count: 0 }),
    ...patch,
  };
}
