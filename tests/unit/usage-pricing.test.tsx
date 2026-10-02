import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { Consumption } from "@/features/usage/Consumption";
import { PriceSources } from "@/features/usage/PriceSources";
import { initI18n } from "@/i18n";
import { metrics, overview } from "./usage-fixtures";

beforeAll(async () => { await initI18n("en"); });
afterEach(cleanup);

it("keeps pricing explanations behind an accessible info button", () => {
  render(<Consumption data={overview({ summary: metrics({ valuation_bases: { current_price_comparison: 2 }, unpriced_fact_count: 1 }) })} group="model" onGroupChange={() => {}} />);
  expect(screen.getByRole("heading", { name: "Current API equivalent" })).toBeTruthy();
  expect(screen.getByText("$0.00", { selector: "strong" })).toBeTruthy();
  expect(screen.queryByText(/Estimated at standard/)).toBeNull();
  const info = screen.getByRole("button", { name: "About this amount" });
  fireEvent.click(info);
  expect(screen.getByRole("dialog", { name: "About this amount" })).toBeTruthy();
  expect(screen.getByText("Detailed value: $0.00292")).toBeTruthy();
  expect(screen.getByText(/excluding subscriptions/)).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(info);
});

it("keeps mixed valuations distinct and price sources in their own info panel", () => {
  render(<Consumption data={overview({ summary: metrics({ valuation_bases: { current_price_comparison: 1, historical_tariff: 1 } }) })} group="model" onGroupChange={() => {}} />);
  expect(screen.getByRole("heading", { name: "Known USD equivalent" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Current API equivalent" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "About this amount" }));
  expect(screen.getByText("Current API prices, Historical tariff")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByText("Price-source freshness unavailable.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Price sources" }));
  expect(screen.getByText("Price-source freshness unavailable.")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows equally weighted token metrics and explains missing values on hover", () => {
  const { container } = render(<Consumption data={overview()} group="model" onGroupChange={() => {}} />);
  const tokens = container.querySelector(".usage-token-metrics")!;
  expect(tokens.querySelectorAll("strong")).toHaveLength(3);
  for (const label of ["In", "Cache in", "Out"]) expect(within(tokens as HTMLElement).getByText(label)).toBeTruthy();
  const unknowns = screen.getAllByTitle("Unavailable, not zero.");
  expect(unknowns.length).toBeGreaterThan(0);
  for (const unknown of unknowns) expect(unknown.getAttribute("tabindex")).toBe("0");
  expect(container.querySelector(".usage-quality")).toBeNull();
  expect(screen.queryByText("Partial")).toBeNull();
});

it("consolidates incomplete, unclassified and excluded usage in one collapsed notice", () => {
  const { container } = render(<Consumption data={overview({
    summary: metrics({ incomplete_fact_count: 2, unpriced_fact_count: 1, unclassified_fact_count: 1, unpriced_reasons: { model_missing: 1 } }),
    sync_state: { scope: "daemon", status: "available", discarded_event_count: 4, discard_reasons: { malformed_record: 1, oversize_record: 1, unproven_reset: 1, missing_model: 1 } },
  })} group="model" onGroupChange={() => {}} />);
  expect(container.querySelectorAll(".usage-notice")).toHaveLength(1);
  expect(container.querySelector(".usage-badge")).toBeNull();
  const quality = container.querySelector<HTMLDetailsElement>(".usage-quality")!;
  expect(quality.open).toBe(false);
  expect(quality.querySelector("summary")?.textContent).toContain("4 excluded daemon events");
  expect(quality.querySelector("summary")?.textContent).toContain("1 unclassified");
  for (const reason of ["Malformed records", "Oversized records", "Unverified counter resets", "Missing model identity"]) {
    expect(within(quality).getByText(reason)).toBeTruthy();
  }
});

it("uses each source's last successful review, keeps stale sources visible, and marks missing syncs", () => {
  const reviewed = 1789800000000;
  const data = overview({
    catalog: {
      public: {
        version: 1,
        sources: {
          "https://models.dev/api.json": {
            price_count: 10,
            reviewed_at: reviewed,
            checked_at: reviewed + 3600000,
            error: null,
            retry_at: 1789990000000,
          },
          "https://openrouter.ai/api/v1/models": {
            price_count: 5,
            reviewed_at: reviewed - 1000,
            error: "TimeoutError",
            retry_at: 1789990000000,
          },
          "https://missing.example/prices": {
            price_count: 0,
            reviewed_at: null,
            error: "HTTPError",
            retry_at: 1789990000000,
          },
        },
      },
    },
  });
  render(<PriceSources data={data} />);
  const models = within(screen.getByText("models.dev").closest("li")!);
  expect(models.getByText("Available")).toBeTruthy();
  expect(
    models.getByText(`Last successful price sync: ${new Date(reviewed + 3600000).toLocaleString("en")}`),
  ).toBeTruthy();
  expect(screen.getByText("Last update failed. Prices are stale.")).toBeTruthy();
  expect(screen.getByText("No successful price sync recorded")).toBeTruthy();
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.queryByText("TimeoutError")).toBeNull();
});

it("marks a cached catalog due for refresh using the snapshot time", () => {
  render(
    <PriceSources
      data={overview({
        as_of: 10000,
        catalog: {
          public: {
            sources: {
              "https://models.dev/api.json": { reviewed_at: 1000, retry_at: 9000, error: null },
            },
          },
        },
      })}
    />,
  );
  expect(screen.getByText("Price update due")).toBeTruthy();
});

it("tolerates absent and malformed catalog metadata without inventing freshness", () => {
  const view = render(<PriceSources data={overview()} />);
  expect(screen.getByText("Price-source freshness unavailable.")).toBeTruthy();
  view.rerender(
    <PriceSources
      data={overview({
        catalog: {
          public: {
            sources: {
              "unknown-source": { reviewed_at: "yesterday", retry_at: 123 },
              "invalid-source": null,
            },
          },
        },
      })}
    />,
  );
  expect(screen.getByText("unknown-source")).toBeTruthy();
  expect(screen.getByText("No successful price sync recorded")).toBeTruthy();
  expect(screen.queryByText("invalid-source")).toBeNull();
});
