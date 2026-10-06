import { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ConnectionOverlay,
  CONNECTION_FADE_MS,
  CONNECTION_GRACE_MS,
} from "@/app/ConnectionOverlay";
import { Shell } from "@/app/Shell";
import { connectionStore, type ConnectionStatus } from "@/stores/connection";
import { initI18n } from "@/i18n";

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  vi.useFakeTimers();
  connectionStore.setState({ ...connectionStore.getInitialState(), disconnectedAt: Date.now() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = async (ms: number) => {
  await act(() => vi.advanceTimersByTimeAsync(ms));
};
const status = (next: ConnectionStatus) => act(() => connectionStore.getState().setStatus(next));
const overlay = () => screen.queryByRole("dialog", { name: "Connecting to Mandri" });
function mount() {
  return render(
    <StrictMode>
      <ConnectionOverlay onRetry={() => connectionStore.getState().setStatus("connecting")}>
        <Shell route={{ name: "dashboard" }}>
          <input aria-label="Draft" defaultValue="Keep my work" />
        </Shell>
      </ConnectionOverlay>
    </StrictMode>,
  );
}
async function connect() {
  status("online");
  await advance(CONNECTION_FADE_MS);
}

it("always covers initial startup and fades out when the daemon connects", async () => {
  mount();
  expect(overlay()).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Starting Mandri…");
  expect(document.querySelector(".connection-app")?.hasAttribute("inert")).toBe(true);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  status("online");
  expect(document.querySelector(".connection-overlay--leaving")).toBeTruthy();
  expect(document.querySelector(".connection-overlay-status")?.textContent).toBe(
    "Starting Mandri…",
  );
  expect(document.querySelector(".connection-app")?.hasAttribute("inert")).toBe(false);
  await advance(CONNECTION_FADE_MS);
  expect(document.querySelector(".connection-overlay")).toBeNull();
});

it("keeps the app mounted and only the orange status visible during a short outage", async () => {
  mount();
  await connect();
  const draft = screen.getByRole("textbox", { name: "Draft" });
  draft.focus();
  status("reconnecting");
  await advance(CONNECTION_GRACE_MS - 1);
  expect(overlay()).toBeNull();
  expect(document.querySelector(".status-dot--reconnecting")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  status("online");
  await advance(CONNECTION_GRACE_MS * 2);
  expect(overlay()).toBeNull();
  expect(document.activeElement).toBe(draft);
});

it("shows the overlay after exactly 20 seconds without resetting on retry status changes", async () => {
  mount();
  await connect();
  const draft = screen.getByRole("textbox", { name: "Draft" });
  draft.focus();
  status("reconnecting");
  const disconnectedAt = connectionStore.getState().disconnectedAt;
  await advance(10_000);
  status("connecting");
  act(() => connectionStore.getState().setReconnectAttempt(4));
  await advance(9_999);
  status("reconnecting");
  expect(connectionStore.getState().disconnectedAt).toBe(disconnectedAt);
  expect(overlay()).toBeNull();
  await advance(1);
  expect(overlay()).toBeTruthy();
  expect(screen.getByText("Reconnecting…")).toBeTruthy();
  expect(overlay()?.contains(document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(overlay()).toBeTruthy();
  expect(connectionStore.getState().disconnectedAt).toBe(disconnectedAt);
  await connect();
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Keep my work");
  expect(document.activeElement).toBe(draft);
});

it("gives every new outage its own grace period, including disconnection during the fade", async () => {
  mount();
  status("online");
  await advance(50);
  status("reconnecting");
  await advance(CONNECTION_FADE_MS);
  expect(overlay()).toBeNull();
  await advance(CONNECTION_GRACE_MS);
  expect(overlay()).toBeTruthy();
  await connect();
  status("reconnecting");
  await advance(CONNECTION_GRACE_MS - 1);
  expect(overlay()).toBeNull();
  await advance(1);
  expect(overlay()).toBeTruthy();
});

it("does not reset the outage deadline when the wrapper is remounted", async () => {
  const view = mount();
  await connect();
  status("reconnecting");
  await advance(15_000);
  view.unmount();
  mount();
  await advance(4_999);
  expect(overlay()).toBeNull();
  await advance(1);
  expect(overlay()).toBeTruthy();
});

it("offers recovery on a slow first start without falsely claiming it failed", async () => {
  mount();
  await advance(CONNECTION_GRACE_MS);
  expect(screen.getByRole("status").textContent).toBe("Starting Mandri…");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
  expect(screen.getByRole("region", { name: "Connection settings" })).toBeTruthy();
});

it("shows an initial startup failure and lets retry return to the loading view", async () => {
  mount();
  act(() => connectionStore.getState().setStartupError("Installation failed"));
  status("offline");
  expect(screen.getByRole("alert").textContent).toBe("Unable to connect to Mandri");
  expect(screen.getByText("Installation failed")).toBeTruthy();
  act(() => connectionStore.getState().setStartupError(null));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByRole("status").textContent).toBe("Starting Mandri…");
  await connect();
  expect(overlay()).toBeNull();
});

it("respects the grace period even for an offline error after an earlier connection", async () => {
  mount();
  await connect();
  act(() => connectionStore.getState().setStartupError("Daemon unavailable"));
  status("offline");
  await advance(CONNECTION_GRACE_MS - 1);
  expect(overlay()).toBeNull();
  await advance(1);
  expect(screen.getByRole("alert").textContent).toBe("Unable to connect to Mandri");
  await connect();
  expect(connectionStore.getState().startupError).toBeNull();
});
