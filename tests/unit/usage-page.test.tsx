import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { UsagePage, formatUsageUsd } from "@/features/usage/UsagePage";
import { usageApi } from "@/daemon/rest/usage";
import { connectionStore } from "@/stores/connection";
import { initI18n } from "@/i18n";
import { parseHash, routeToHash } from "@/app/useHashRoute";
import { metrics, overview } from "./usage-fixtures";
beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  connectionStore.getState().setStatus("online");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.spyOn(usageApi, "overview").mockResolvedValue(overview());
  vi.spyOn(usageApi, "capabilities").mockResolvedValue({ capabilities: [], as_of: 1 });
  vi.spyOn(usageApi, "accounts").mockResolvedValue({ accounts: [], as_of: 1, revision: 1 });
  vi.spyOn(usageApi, "refresh").mockResolvedValue({ status: "queued", retry_after_ms: 15000 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("discloses excluded source overlaps even when retained facts have complete counters", async () => {
  vi.mocked(usageApi.overview).mockResolvedValue(
    overview({
      sync_state: {
        scope: "daemon",
        status: "partial",
        source_count: 0,
        gap_count: 2,
        status_counts: {},
      },
    }),
  );
  render(<UsagePage />);
  await screen.findByText(/2 collection gaps/);
  expect(screen.getByText("Partial data")).toBeTruthy();
});

it("round trips global, project, and session usage deep links", () => {
  for (const route of [
    { name: "usage" as const },
    { name: "usage" as const, sessionId: "s/?&" },
    { name: "usage" as const, projectPath: "/a b/project" },
  ])
    expect(parseHash(routeToHash(route))).toEqual(route);
});

it("renders known zero distinctly from missing values and offers an accessible daily table", async () => {
  vi.mocked(usageApi.overview).mockResolvedValue(
    overview({
      summary: metrics({
        usd_equivalent: "0",
        total_tokens: null,
        request_count: 0,
        missing_fields: { total_tokens: 1 },
        unpriced_fact_count: 1,
      }),
    }),
  );
  render(<UsagePage />);
  await screen.findByText("$0.00", { selector: "strong" });
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  expect(screen.getByText("Partial data")).toBeTruthy();
  expect(screen.getByRole("button", { name: "About this amount" })).toBeTruthy();
  fireEvent.click(screen.getByText("Show daily data table"));
  expect(screen.getByRole("table", { name: "Daily usage" })).toBeTruthy();
  expect(usageApi.refresh).not.toHaveBeenCalled();
  expect(formatUsageUsd("0.00292", "en")).toBe("$0.00292");
  expect(formatUsageUsd(null, "en")).toBe("—");
});

it("defaults global/project to last 30 days, session to lifetime and includes deleted records", async () => {
  const mounted = render(<UsagePage projectPath="/historical/project" />);
  await waitFor(() => expect(usageApi.overview).toHaveBeenCalled());
  expect(vi.mocked(usageApi.overview).mock.calls.at(-1)?.[0]).toMatchObject({
    period: "last30d",
    includeDeleted: true,
    scope: { kind: "project", id: "/historical/project" },
  });
  mounted.unmount();
  render(<UsagePage sessionId="deleted-session" />);
  await waitFor(() =>
    expect(vi.mocked(usageApi.overview).mock.calls.at(-1)?.[0].period).toBe("lifetime"),
  );
  fireEvent.click(screen.getByLabelText("Include attributed descendants"));
  await waitFor(() =>
    expect(vi.mocked(usageApi.overview).mock.calls.at(-1)?.[0].includeDescendants).toBe(false),
  );
  expect(screen.getByText(/Direct session usage only/)).toBeTruthy();
});

it("distinguishes empty coverage from zero consumption and discloses undated usage", async () => {
  vi.mocked(usageApi.overview).mockResolvedValue(
    overview({
      summary: metrics({
        fact_count: 0,
        usd_equivalent: null,
        total_tokens: null,
        request_count: null,
      }),
      timeseries: [],
      breakdown: [],
      breakdown_total: 0,
      undated: metrics(),
    }),
  );
  render(<UsagePage />);
  await screen.findByText(/This does not establish zero consumption/);
  expect(screen.getByText("Undated history")).toBeTruthy();
  expect(screen.getByText("No daily measurements available.")).toBeTruthy();
});

it("renders account allowances without technical status badges or invented gauges", async () => {
  vi.mocked(usageApi.accounts).mockResolvedValue({
    revision: 1,
    as_of: 1789900000000,
    accounts: [
      {
        account_id: "unknown",
        harness: "claude",
        observed_at: 1789900000000,
        status: "unavailable",
        verified: false,
        plan: null,
        auth_mode: null,
        windows: [],
      },
      {
        account_id: "old",
        harness: "codex",
        observed_at: 1789900000000,
        status: "stale",
        verified: true,
        plan: "Plus",
        auth_mode: "native",
        windows: [{ label: "Five hour", used_percent: 0, resets_at: null }],
      },
      {
        account_id: "current",
        harness: "agy",
        observed_at: 1789900000000,
        status: "available",
        verified: true,
        plan: null,
        auth_mode: "native",
        windows: [{ label: "Weekly", used_percent: 70, resets_at: 1789900000 }],
      },
    ],
  });
  render(<UsagePage />);
  fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
  await screen.findByText("ChatGPT Plus");
  expect(screen.queryByText("Stale snapshot")).toBeNull();
  expect(screen.queryByText("Unavailable")).toBeNull();
  expect(screen.getByText("Allowances are currently unavailable.")).toBeTruthy();
  expect(screen.getByText(/Account-wide allowances/).closest("footer")).toBeTruthy();
  expect(screen.getByText(/Account-wide allowances/).nextElementSibling).toBeNull();
  expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  expect(screen.getByRole("progressbar", { name: "Five hour" }).getAttribute("value")).toBe("0");
});

it("keeps metric erasure separate and requires explicit confirmation", async () => {
  render(<UsagePage sessionId="s-one" />);
  await screen.findByText(/Snapshot:/);
  fireEvent.click(screen.getByText("Erase session metrics", { selector: "summary" }));
  const button = screen.getByRole("button", { name: "Erase session metrics" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I understand and want/));
  expect(button.disabled).toBe(false);
  expect(screen.getByText(/Stop a running session first/)).toBeTruthy();
});

it("shows a disabled refresh button and spinner only while the request runs", async () => {
  vi.mocked(usageApi.refresh).mockReturnValueOnce(new Promise(() => {}));
  render(<UsagePage />);
  await screen.findByText(/Snapshot:/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh sources" }));
  await waitFor(() => expect(usageApi.refresh).toHaveBeenCalledTimes(1));
  const button = screen.getByRole("button", { name: "Refreshing sources" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector(".usage-refresh-spinner")).toBeTruthy();
  expect(screen.queryByText(/Refresh queued/)).toBeNull();
});

it("keeps cards and chart mounted when toggling the directly visible inclusion checkbox", async () => {
  const { container } = render(<UsagePage />);
  await screen.findByText("$0.00", { selector: "strong" });
  const checkbox = screen.getByRole("checkbox", { name: "Include deleted sessions" });
  expect(checkbox.closest("details")).toBeNull();
  expect(screen.queryByText("Inclusion options")).toBeNull();
  const cards = container.querySelector(".usage-cards");
  const chart = container.querySelector(".usage-chart-panel");
  let resolve!: (value: ReturnType<typeof overview>) => void;
  vi.mocked(usageApi.overview).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  fireEvent.click(checkbox);
  await waitFor(() =>
    expect(container.querySelector(".usage-results")?.getAttribute("aria-busy")).toBe("true"),
  );
  expect(container.querySelector(".usage-cards")).toBe(cards);
  expect(container.querySelector(".usage-chart-panel")).toBe(chart);
  expect(container.querySelector(".usage-skeleton")).toBeNull();
  resolve(overview({ revision: 2 }));
  await waitFor(() =>
    expect(container.querySelector(".usage-results")?.getAttribute("aria-busy")).toBe("false"),
  );
  expect(container.querySelector(".usage-cards")).toBe(cards);
  expect(container.querySelector(".usage-chart-panel")).toBe(chart);
});
