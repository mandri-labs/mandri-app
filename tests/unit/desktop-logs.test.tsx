import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionOverlay } from "@/app/ConnectionOverlay";
import { connectionStore } from "@/stores/connection";
import { initI18n } from "@/i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeAll(async () => { await initI18n("en"); });

afterEach(() => {
  cleanup();
  delete window.__TAURI_INTERNALS__;
  vi.resetAllMocks();
  connectionStore.setState(connectionStore.getInitialState());
});

it("opens desktop diagnostics without requiring a daemon connection", async () => {
  window.__TAURI_INTERNALS__ = {};
  connectionStore.setState({ status: "offline", startupError: "Backend installation failed" });
  vi.mocked(invoke).mockRejectedValue(new Error("Cannot open logs folder"));
  const retry = vi.fn();
  render(<ConnectionOverlay onRetry={retry}>Dashboard</ConnectionOverlay>);
  fireEvent.click(screen.getByRole("button", { name: "Open logs folder" }));
  expect(invoke).toHaveBeenCalledWith("open_logs");
  expect(await screen.findByText("Error: Cannot open logs folder")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("does not offer desktop log access in the web client", () => {
  connectionStore.setState({ status: "offline" });
  render(<ConnectionOverlay onRetry={() => undefined}>Dashboard</ConnectionOverlay>);
  expect(screen.queryByRole("button", { name: "Open logs folder" })).toBeNull();
});
