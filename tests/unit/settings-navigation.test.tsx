import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { App } from "@/app/App";
import { navigate, parseHash, type Route } from "@/app/useHashRoute";
import { initI18n } from "@/i18n";

vi.mock("@/app/connection", () => ({ connectDaemon: vi.fn() }));
vi.mock("@/app/ConnectionOverlay", () => ({
  ConnectionOverlay: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/app/Shell", () => ({
  Shell: ({ route, children }: { route: Route; children: ReactNode }) => (
    <div data-testid="shell" data-route={JSON.stringify(route)}>
      <button onClick={() => navigate({ name: "settings" })}>Open settings</button>
      {children}
    </div>
  ),
}));
vi.mock("@/app/panes/PaneManager", () => ({
  PaneManager: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/app/CommandPalette", () => ({ CommandPaletteHost: () => null }));
vi.mock("@/app/ShortcutSheet", () => ({ ShortcutSheetHost: () => null }));
vi.mock("@/features/agents/useAgentsSync", () => ({ useAgentsSync: vi.fn() }));
vi.mock("@/features/agents/AgentView", () => ({ AgentView: () => null }));
vi.mock("@/features/providers/ProvidersPage", () => ({ ProvidersPage: () => null }));
vi.mock("@/features/providers/RoutesPage", () => ({ RoutesPage: () => null }));
vi.mock("@/features/usage/UsagePage", () => ({ UsagePage: () => null }));
vi.mock("@/features/sessions/DashboardPage", () => ({
  DashboardPage: () => <textarea aria-label="New conversation draft" />,
}));
vi.mock("@/features/transcript/SessionView", () => ({
  SessionView: ({ sessionId }: { sessionId: string }) => (
    <textarea aria-label={`Session ${sessionId} draft`} />
  ),
}));
vi.mock("@/daemon/rest/runtime", () => ({ listRuntimes: vi.fn(async () => []) }));

beforeAll(async () => {
  await initI18n("en");
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/");
});

async function goTo(route: Route) {
  navigate(route);
  await waitFor(() => {
    if (route.name === "settings") {
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    } else {
      expect(screen.getByTestId("shell").dataset.route).toBe(JSON.stringify(route));
    }
  });
}

async function expectClosedAt(hash: string) {
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(window.location.hash).toBe(hash);
  });
}

describe("settings navigation", () => {
  it.each(["button", "escape", "backdrop"])(
    "keeps the session mounted and restores it when closed using %s",
    async (closeMethod) => {
      window.history.replaceState(null, "", "#/session/current");
      const { container } = render(<App />);
      const draft = screen.getByRole("textbox", { name: "Session current draft" });
      fireEvent.change(draft, { target: { value: "Unsent follow-up" } });
      fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
      await screen.findByRole("dialog", { name: "Settings" });
      expect(screen.getByRole("textbox", { name: "Session current draft" })).toBe(draft);
      expect(screen.queryByRole("textbox", { name: "New conversation draft" })).toBeNull();
      if (closeMethod === "escape") fireEvent.keyDown(document, { key: "Escape" });
      else if (closeMethod === "backdrop")
        fireEvent.click(container.querySelector(".settings-modal-overlay")!);
      else fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await expectClosedAt("#/session/current");
      expect(screen.getByRole("textbox", { name: "Session current draft" })).toBe(draft);
      expect((draft as HTMLTextAreaElement).value).toBe("Unsent follow-up");
    },
  );

  it("returns to the latest session even after navigating between settings sections", async () => {
    window.history.replaceState(null, "", "#/session/first");
    render(<App />);
    await goTo({ name: "session", id: "second" });
    await goTo({ name: "settings", section: "connection" });
    await goTo({ name: "settings" });
    fireEvent.keyDown(document, { key: "Escape" });
    await expectClosedAt("#/session/second");
  });

  it("preserves a new conversation draft and its project options", async () => {
    const hash = "#/?cwd=%2Fworkspace&worktree=1&surrogate=1";
    window.history.replaceState(null, "", hash);
    render(<App />);
    const draft = screen.getByRole("textbox", { name: "New conversation draft" });
    fireEvent.change(draft, { target: { value: "New task draft" } });
    await goTo({ name: "settings" });
    fireEvent.keyDown(document, { key: "Escape" });
    await expectClosedAt(hash);
    expect(screen.getByRole("textbox", { name: "New conversation draft" })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe("New task draft");
  });

  it("opens MCP settings without replacing the session or its draft", async () => {
    window.history.replaceState(null, "", "#/session/current");
    render(<App />);
    const draft = screen.getByRole("textbox", { name: "Session current draft" });
    fireEvent.change(draft, { target: { value: "Unsent follow-up" } });
    await goTo({ name: "settings", section: "connection" });
    await goTo({ name: "settings", section: "mcp" });
    await screen.findByRole("heading", { name: "MCP Servers", level: 2 });
    const nav = screen.getByRole("navigation", { name: "Settings" });
    const entries = [...nav.querySelectorAll("button")];
    const providers = entries.findIndex((entry) => entry.textContent === "Providers");
    expect(entries[providers + 1]?.textContent).toBe("MCP Servers");
    expect(screen.getByRole("textbox", { name: "Session current draft" })).toBe(draft);
    fireEvent.keyDown(document, { key: "Escape" });
    await expectClosedAt("#/session/current");
    expect((draft as HTMLTextAreaElement).value).toBe("Unsent follow-up");
    expect(parseHash("#/mcp")).toEqual({ name: "settings", section: "mcp" });
  });

  it("falls back to a new conversation when settings is opened directly", async () => {
    window.history.replaceState(null, "", "#/settings");
    render(<App />);
    fireEvent.keyDown(document, { key: "Escape" });
    await expectClosedAt("#/");
    expect(screen.getByRole("textbox", { name: "New conversation draft" })).toBeTruthy();
  });
});
