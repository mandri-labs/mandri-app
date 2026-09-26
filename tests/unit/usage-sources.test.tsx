import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { Consumption } from "@/features/usage/Consumption";
import { initI18n } from "@/i18n";
import { metrics, overview } from "./usage-fixtures";

beforeAll(async () => {
  await initI18n("en");
});
afterEach(cleanup);

it("adds the source card directly after the API equivalent, independently of table rows", () => {
  const { container } = render(
    <Consumption
      data={overview({
        source_breakdown: {
          gateway: metrics({ usd_equivalent: "12.34" }),
          codex: metrics({ usd_equivalent: "50" }),
          claude: metrics({ fact_count: 0, usd_equivalent: null }),
          agy: metrics({ usd_equivalent: null, unpriced_fact_count: 1 }),
        },
        breakdown: [],
      })}
      group="session"
      onGroupChange={() => {}}
    />,
  );
  const cards = container.querySelectorAll(".usage-cards > article");
  expect(cards).toHaveLength(4);
  expect(cards[1]?.getAttribute("aria-labelledby")).toBe("usage-sources-title");
  const card = within(screen.getByRole("article", { name: "By source" }));
  expect(card.getByText("API · Gateway").nextElementSibling?.textContent).toBe("$12.34");
  expect(card.getByText("Codex").nextElementSibling?.textContent).toBe("$50.00");
  expect(card.getByText("Claude").nextElementSibling?.textContent).toBe("$0.00");
  expect(card.getByText("Antigravity").nextElementSibling?.textContent).toBe("—");
});

it("keeps absent source data unknown when connected to an older daemon", () => {
  render(<Consumption data={overview()} group="model" onGroupChange={() => {}} />);
  const card = within(screen.getByRole("article", { name: "By source" }));
  expect(card.getAllByText("—")).toHaveLength(4);
  expect(card.queryByText("$0.00")).toBeNull();
});

it("shows unallocated origins and marks partial known amounts", () => {
  render(
    <Consumption
      data={overview({
        source_breakdown: {
          gateway: metrics({ usd_equivalent: "0.000123", unpriced_fact_count: 1 }),
          other: metrics({ usd_equivalent: "2.5" }),
        },
      })}
      group="model"
      onGroupChange={() => {}}
    />,
  );
  const card = within(screen.getByRole("article", { name: "By source" }));
  expect(card.getByLabelText("Known subtotal only")).toBeTruthy();
  expect(card.getByText("API · Gateway").nextElementSibling?.getAttribute("title")).toBe(
    "$0.000123 · Known subtotal only",
  );
  expect(card.getByText("Other").nextElementSibling?.textContent).toBe("$2.50");
});
