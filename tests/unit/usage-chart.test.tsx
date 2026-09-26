import { afterEach, beforeAll, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { UsageChart } from "@/features/usage/UsageChart";
import { formatUsageDate } from "@/features/usage/format";
import { initI18n } from "@/i18n";
import { metrics, overview } from "./usage-fixtures";

beforeAll(async () => {
  await initI18n("en");
});
afterEach(cleanup);

it("keeps sparse calendar spacing without generating missing days or interpolating usage", () => {
  render(
    <UsageChart
      data={overview({
        timeseries: [
          { date: "2026-09-20", ...metrics({ usd_equivalent: "0.25" }) },
          { date: "2026-09-01", ...metrics({ usd_equivalent: null }) },
          { date: "2026-09-02", ...metrics({ usd_equivalent: "0" }) },
        ],
      })}
    />,
  );
  const chart = screen.getByRole("group", { name: "Daily usage" });
  const bars = within(chart).getAllByRole("button");
  expect(bars).toHaveLength(3);
  expect(bars[0]!.getAttribute("aria-label")).toBe("Sep 1: Unavailable, not zero.");
  expect(bars[1]!.getAttribute("aria-label")).toBe("Sep 2: $0.00");
  expect(bars[2]!.getAttribute("aria-label")).toBe("Sep 20: $0.25");
  expect(bars[0]!.style.left).toBe("2.5%");
  expect(bars[1]!.style.left).toBe("7.5%");
  expect(bars[2]!.style.left).toBe("97.5%");
  expect(bars[0]!.querySelector(".usage-bar")).toBeNull();
  expect(bars[1]!.querySelector(".usage-bar--zero")).not.toBeNull();
});

it("offers one chart tab stop, keyboard navigation and exact values in either metric", () => {
  const { container } = render(
    <UsageChart
      data={overview({
        timeseries: [
          { date: "2026-09-19", ...metrics({ usd_equivalent: "0.000123", total_tokens: 321 }) },
          { date: "2026-09-20", ...metrics({ usd_equivalent: "0.24", total_tokens: null }) },
        ],
      })}
    />,
  );
  const bars = within(screen.getByRole("group", { name: "Daily usage" })).getAllByRole("button");
  expect(bars.map((bar) => bar.tabIndex)).toEqual([0, -1]);
  act(() => bars[0]!.focus());
  expect(container.querySelector(".usage-chart-readout")?.textContent).toBe("Sep 19$0.000123");
  fireEvent.keyDown(bars[0]!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(bars[1]!);
  expect(bars.map((bar) => bar.tabIndex)).toEqual([-1, 0]);
  fireEvent.click(screen.getByRole("button", { name: "Tokens" }));
  expect(container.querySelector(".usage-chart-readout")?.textContent).toBe("Sep 20—");
  fireEvent.keyDown(bars[1]!, { key: "Home" });
  expect(document.activeElement).toBe(bars[0]!);
  expect(container.querySelector(".usage-chart-readout")?.textContent).toBe("Sep 19321");
  fireEvent.keyDown(bars[0]!, { key: "End" });
  expect(document.activeElement).toBe(bars[1]!);
});

it("does not present unknown prices as zero on the axis", () => {
  const { container } = render(
    <UsageChart
      data={overview({
        timeseries: [{ date: "2026-09-20", ...metrics({ usd_equivalent: null }) }],
      })}
    />,
  );
  expect(container.querySelector(".usage-chart-axis")?.textContent).toBe("———");
  expect(formatUsageDate("2026-01-01", "en")).toBe("Jan 1");
});
