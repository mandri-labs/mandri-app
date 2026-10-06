import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUsageInvalidation } from "@/features/usage/useUsageInvalidation";
import { dispatchFrame } from "@/app/framePipeline";
import { connectionStore } from "@/stores/connection";

const socket = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/app/connection", () => ({ getDaemonSocket: () => socket }));
function Harness({ reload }: { reload: () => void }) {
  useUsageInvalidation(reload);
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  connectionStore.getState().setStatus("online");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("coalesces usage revisions and removes its subscription when hidden or closed", async () => {
  const reload = vi.fn();
  const mounted = render(<Harness reload={reload} />);
  expect(socket.subscribe).toHaveBeenCalledWith("usage.changed");
  for (let seq = 1; seq <= 5; seq++)
    dispatchFrame({ topic: "usage.changed", seq, source: "mandri", raw: { revision: seq }, ts: 1 });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenLastCalledWith(5);
  dispatchFrame({ op: "subscribed", topic: "usage.changed", from_seq: 0 });
  for (const revision of [5, 4, -1, NaN, 1.5])
    dispatchFrame({ topic: "usage.changed", seq: 10, source: "mandri", raw: { revision }, ts: 1 });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(reload).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(socket.unsubscribe).toHaveBeenCalledWith("usage.changed");
  dispatchFrame({ topic: "usage.changed", seq: 6, source: "mandri", raw: { revision: 6 }, ts: 1 });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(reload).toHaveBeenCalledTimes(1);
  mounted.unmount();
  expect(socket.unsubscribe).toHaveBeenCalledTimes(2);
});
