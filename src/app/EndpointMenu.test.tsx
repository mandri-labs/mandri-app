import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { preferencesStore } from "@/stores/preferences";
import { connectionStore } from "@/stores/connection";
import { LOCAL_ENDPOINT } from "@/stores/endpoints";
import { connectDaemon } from "./connection";
import { navigate } from "./useHashRoute";
import { EndpointMenu } from "./EndpointMenu";

vi.mock("./connection", () => ({ connectDaemon: vi.fn() }));
vi.mock("./useHashRoute", () => ({ navigate: vi.fn() }));

beforeAll(() => initI18n("en"));
beforeEach(() => {
  vi.clearAllMocks();
  preferencesStore.setState({
    endpoints: [LOCAL_ENDPOINT, { id: "studio", name: "Studio", url: "https://studio.example" }],
    selectedEndpointId: "local",
    daemonBaseUrl: LOCAL_ENDPOINT.url,
  });
  connectionStore.getState().setStatus("online");
});
afterEach(cleanup);

describe("EndpointMenu", () => {
  it("opens the quick picker without navigating, with Local selected", () => {
    render(<EndpointMenu />);
    const trigger = screen.getByRole("button", { name: "Connection: Local" });
    expect(trigger.querySelector(".lucide-monitor")).toBeTruthy();
    expect(trigger.querySelector(".status-dot--online")).toBeTruthy();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Local/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(connectDaemon).not.toHaveBeenCalled();
  });

  it("switches endpoint, reconnects, leaves the old session route and updates the pill", () => {
    render(<EndpointMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Connection: Local" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Studio/ }));
    expect(preferencesStore.getState().daemonBaseUrl).toBe("https://studio.example");
    expect(connectDaemon).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ name: "dashboard" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Connection: Studio" }).querySelector(".lucide-server"),
    ).toBeTruthy();
  });

  it("preserves the current session when choosing the active endpoint", () => {
    render(<EndpointMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Connection: Local" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Local/ }));
    expect(navigate).not.toHaveBeenCalled();
    expect(connectDaemon).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("supports keyboard dismissal and the connection settings shortcut while offline", () => {
    connectionStore.getState().setStatus("offline");
    render(<EndpointMenu />);
    const trigger = screen.getByRole("button", { name: "Connection: Local" });
    expect(trigger.querySelector(".status-dot--offline")).toBeTruthy();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Connection settings");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    expect(navigate).toHaveBeenCalledWith({ name: "settings", section: "connection" });
  });
});
