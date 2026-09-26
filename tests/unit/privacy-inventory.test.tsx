import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PrivacyInventory } from "@/features/sessions/PrivacyInventory";
import { getSessionPrivacy } from "@/daemon/rest/sessions";
import { initI18n } from "@/i18n";

vi.mock("@/daemon/rest/sessions", () => ({ getSessionPrivacy: vi.fn() }));
beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("renders exactly the redacted registry returned by the daemon and refreshes it", async () => {
  vi.mocked(getSessionPrivacy)
    .mockResolvedValueOnce({
      revision: 1,
      entries: [{ kind: "email", redacted: "cam****@****invalid" }],
    })
    .mockResolvedValue({
      revision: 2,
      entries: [
        { kind: "email", redacted: "cam****@****invalid" },
        { kind: "secret", redacted: "********" },
      ],
    });
  await act(async () => {
    render(<PrivacyInventory sessionId="synthetic" />);
  });
  expect(screen.getByText("cam****@****invalid")).toBeTruthy();
  expect(screen.getByText("1 protected value")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.getByText("2 protected values")).toBeTruthy();
  expect(screen.getByText("********")).toBeTruthy();
  expect(getSessionPrivacy).toHaveBeenCalledWith(
    "synthetic",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it("hides stale entries on refresh failure and cancels polling when closed", async () => {
  vi.mocked(getSessionPrivacy)
    .mockResolvedValueOnce({
      revision: 1,
      entries: [{ kind: "email", redacted: "cam****@****invalid" }],
    })
    .mockRejectedValue(new Error("unavailable"));
  let unmount: () => void;
  await act(async () => {
    unmount = render(<PrivacyInventory sessionId="synthetic" />).unmount;
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText("cam****@****invalid")).toBeNull();
  act(() => unmount());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(getSessionPrivacy).toHaveBeenCalledTimes(2);
});
