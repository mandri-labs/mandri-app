import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { changeLocale } from "@/i18n";
import { connectDaemon, getDaemonSocket } from "@/app/connection";
import { listRuntimes } from "@/daemon/rest/runtime";
import { DEFAULT_DAEMON_BASE_URL, preferencesStore } from "@/stores/preferences";
import { providersStore } from "@/stores/providers";
import { listProviders, listProviderModels } from "@/daemon/rest/providers";
import { SettingsModal } from "./SettingsModal";

vi.mock("@/daemon/rest/providers", () => ({ listProviders: vi.fn(), listProviderModels: vi.fn() }));
vi.mock("@/daemon/rest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/daemon/rest/client")>()),
  request: vi.fn(async () => []),
}));
vi.mock("@/daemon/rest/runtime", () => ({ listRuntimes: vi.fn() }));
vi.mock("@/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n")>();
  return { ...actual, changeLocale: vi.fn(() => Promise.resolve()) };
});
vi.mock("@/app/connection", () => ({
  connectDaemon: vi.fn(),
  getDaemonSocket: vi.fn(() => ({ close: vi.fn() })),
}));

const mockedListRuntimes = vi.mocked(listRuntimes);
const mockedChangeLocale = vi.mocked(changeLocale);
const mockedConnectDaemon = vi.mocked(connectDaemon);

beforeAll(async () => {
  await initI18n("en");
});

function resetPreferences(): void {
  preferencesStore.setState({
    theme: "dark",
    language: "auto",
    resolvedLanguage: "en",
    daemonBaseUrl: DEFAULT_DAEMON_BASE_URL,
    defaultHarness: undefined,
    defaultModel: undefined,
    defaultEffort: null,
    endpoints: [{ id: "local", name: "Local", url: DEFAULT_DAEMON_BASE_URL }],
    selectedEndpointId: "local",
    approvalNotifications: true,
    closeToTray: true,
  });
}

beforeEach(() => {
  cleanup();
  resetPreferences();
  providersStore.setState(providersStore.getInitialState());
  vi.mocked(listProviders).mockResolvedValue([
    { name: "openrouter", kind: "openrouter", state: "verified", api_base: null },
  ]);
  vi.mocked(listProviderModels).mockResolvedValue([
    { id: "gpt-5", reasoning_efforts: ["low", "high"], default_effort: "low" },
  ]);
  mockedListRuntimes.mockReset();
  mockedListRuntimes.mockResolvedValue([]);
  mockedChangeLocale.mockClear();
  mockedConnectDaemon.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SettingsModal", () => {
  it("renders as a dialog and switches sections from the left nav", () => {
    render(<SettingsModal open onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Harnesses" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    expect(screen.getByRole("heading", { name: "Connection" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Defaults" }));
    expect(screen.getByRole("heading", { name: "Session defaults" })).toBeTruthy();
  });

  it("lists harnesses with live install status from listRuntimes", async () => {
    mockedListRuntimes.mockResolvedValue([
      { harness: "claude", installed: true, degraded: false, version: null },
      { harness: "codex", installed: true, degraded: true, version: null },
    ]);
    render(<SettingsModal open onClose={() => undefined} />);
    expect(await screen.findByText("Installed")).toBeTruthy();
    expect(screen.getByText("Degraded")).toBeTruthy();
    expect(screen.getAllByText("Not installed")).toHaveLength(3);
    expect(screen.getByText("Antigravity")).toBeTruthy();
    expect(screen.getByText("Pi")).toBeTruthy();
  });

  it("re-fetches runtimes from the verify pill", async () => {
    mockedListRuntimes.mockResolvedValue([
      { harness: "claude", installed: true, degraded: false, version: null },
    ]);
    render(<SettingsModal open onClose={() => undefined} />);
    const verifyButtons = await screen.findAllByRole("button", { name: "Verify" });
    expect(mockedListRuntimes).toHaveBeenCalledTimes(1);
    fireEvent.click(verifyButtons[0] as HTMLElement);
    await waitFor(() => {
      expect(mockedListRuntimes).toHaveBeenCalledTimes(2);
    });
  });

  it("persists theme without offering transcript density", () => {
    render(<SettingsModal open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByLabelText("Light"));
    expect(preferencesStore.getState().theme).toBe("light");
    expect(screen.queryByLabelText("Transcript density")).toBeNull();
  });

  it("calls changeLocale when the language changes", () => {
    render(<SettingsModal open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(screen.getByLabelText("English"));
    expect(preferencesStore.getState().language).toBe("en");
    expect(mockedChangeLocale).toHaveBeenCalledWith("en");
  });

  it("shows the auto-resolved hint when language is auto", () => {
    render(<SettingsModal open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(screen.getByText("Currently resolved to: English")).toBeTruthy();
  });

  it("validates the daemon URL and reconnects on save", () => {
    const socket = { close: vi.fn() };
    vi.mocked(getDaemonSocket).mockReturnValue(socket as never);
    render(<SettingsModal open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "Desktop" } });
    const input = screen.getByLabelText("Base URL");
    fireEvent.change(input, { target: { value: "not-a-url" } });
    expect(screen.getByText("Enter a valid URL starting with http:// or https://.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save and reconnect" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(input, { target: { value: "http://10.0.0.5:9999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(preferencesStore.getState().daemonBaseUrl).toBe("http://10.0.0.5:9999");
    expect(preferencesStore.getState().endpoints).toHaveLength(2);
    expect(mockedConnectDaemon).toHaveBeenCalled();
  });

  it("toggles notification preferences", () => {
    window.__TAURI_INTERNALS__ = {};
    try {
      render(<SettingsModal open onClose={() => undefined} />);
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
      fireEvent.click(screen.getByLabelText("Notify me when an approval is pending"));
      expect(preferencesStore.getState().approvalNotifications).toBe(false);
      fireEvent.click(screen.getByLabelText("Close button minimizes to tray instead of quitting"));
      expect(preferencesStore.getState().closeToTray).toBe(false);
    } finally {
      delete window.__TAURI_INTERNALS__;
    }
  });

  it("shows the same available fallback as the composer when no preference is saved", async () => {
    mockedListRuntimes.mockResolvedValue([
      { harness: "codex", installed: true, degraded: false, version: null },
      { harness: "claude", installed: true, degraded: false, version: null },
    ]);
    render(<SettingsModal open onClose={() => undefined} initialSection="defaults" />);
    await waitFor(() => expect(screen.getByLabelText("Default harness").textContent).toBe("Codex"));
    fireEvent.click(screen.getByLabelText("Default harness"));
    expect(screen.getByRole("button", { name: "Codex" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    expect(preferencesStore.getState().defaultHarness).toBe("claude");
    expect(screen.getByLabelText("Default harness").textContent).toBe("Claude Code");
  });

  it("saves defaults using the composer model and reasoning menu", async () => {
    render(<SettingsModal open onClose={() => undefined} initialSection="defaults" />);
    fireEvent.click(screen.getByLabelText("Default harness"));
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(preferencesStore.getState().defaultHarness).toBe("codex");
    fireEvent.click(screen.getByLabelText("Default model"));
    fireEvent.change(screen.getByRole("combobox", { name: /Search a model/ }), {
      target: { value: "openrouter/gpt-5" },
    });
    fireEvent.click(await screen.findByTitle("openrouter/gpt-5"));
    expect(preferencesStore.getState().defaultModel).toBe("openrouter/gpt-5");
    fireEvent.click(screen.getByRole("button", { name: "Default model" }));
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.pointerUp(slider);
    expect(preferencesStore.getState().defaultEffort).toBe("high");
    const saved = JSON.parse(localStorage.getItem("mandri.preferences")!);
    expect(saved.state.defaultModel).toBe("openrouter/gpt-5");
    expect(saved.state.defaultEffort).toBe("high");
  });

  it("closes on Escape and on backdrop click but not on panel click", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".settings-modal") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".settings-modal-overlay") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<SettingsModal open={false} onClose={() => undefined} />);
    expect(container.querySelector(".settings-modal")).toBeNull();
  });
});
