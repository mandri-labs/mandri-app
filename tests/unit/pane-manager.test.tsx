import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { ENTER_SPLIT_EVENT, registerWindowKeyboardShortcuts } from "@/app/keyboard";
import { agentsStore } from "@/stores/agents";
import { approvalsStore } from "@/stores/approvals";
import { PaneManager } from "@/app/panes/PaneManager";
import { SessionView } from "@/features/transcript/SessionView";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { panesStore } from "@/stores/panes";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import type { SessionView as SessionRow } from "@/stores/sessions";
import { useHashRoute, navigate, parseHash } from "@/app/useHashRoute";
import { PanePicker } from "@/app/panes/PanePicker";
import { CommandPalette } from "@/app/CommandPalette";

vi.mock("@/daemon/ws/sessionFeed", () => ({
  sessionFeed: {
    ensureSession: vi.fn(),
    closeSession: vi.fn(),
    subscribeSession: vi.fn(),
    unsubscribeSession: vi.fn(),
    loadHistory: vi.fn(async () => undefined),
    sendPrompt: vi.fn(),
    interrupt: vi.fn(async () => true),
  },
}));

const held = vi.hoisted(() => new Map<string, Set<string>>());

vi.mock("@/daemon/ws/keepAlive", () => ({
  keepAlive: {
    acquire: vi.fn((sessionId: string, reason: string) => {
      let reasons = held.get(sessionId);
      if (reasons === undefined) {
        reasons = new Set<string>();
        held.set(sessionId, reasons);
      }
      reasons.add(reason);
    }),
    release: vi.fn((sessionId: string, reason: string) => {
      const reasons = held.get(sessionId);
      if (reasons === undefined) {
        return;
      }
      reasons.delete(reason);
      if (reasons.size === 0) {
        held.delete(sessionId);
      }
    }),
    isHeld: vi.fn((sessionId: string) => (held.get(sessionId)?.size ?? 0) > 0),
    forget: vi.fn((sessionId: string) => {
      held.delete(sessionId);
    }),
  },
}));

const sessionFeedMock = vi.mocked(sessionFeed);
const keepAliveMock = vi.mocked(keepAlive);

function seedSession(partial: Partial<SessionRow> & { id: string }): void {
  const view: SessionRow = {
    harness: "claude",
    state: "live",
    deleted: false,
    title: partial.id,
    pendingApprovals: 0,
    ...partial,
  };
  const state = sessionsStore.getState();
  sessionsStore.setState({
    sessions: { ...state.sessions, [partial.id]: view },
    order: state.order.includes(partial.id) ? state.order : [...state.order, partial.id],
  });
}

function seedTwoSessions(): void {
  seedSession({ id: "s1", lastActivityAt: 100 });
  seedSession({ id: "s2", harness: "codex", lastActivityAt: 200 });
}

beforeAll(async () => {
  await initI18n("en");
});

beforeEach(() => {
  window.history.replaceState(null, "", "#/");
  vi.clearAllMocks();
  held.clear();
  agentsStore.setState({ agents: {}, loaded: true, classifiedSessionIds: ["s1", "s2", "s3"] });
  approvalsStore.getState().reset();
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
  transcriptStore.getState().resetTranscripts();
  panesStore.getState().closeAll();
});

function RoutedWorkspace() {
  const route = useHashRoute();
  if (route.name !== "session" && route.name !== "agent") return null;
  return (
    <PaneManager
      target={{ kind: route.name, id: route.id }}
      workspace={route.workspace ?? null}
      onActivate={(target) => navigate({ name: target.kind, id: target.id })}
    >
      {route.name === "session" && <SessionView sessionId={route.id} />}
    </PaneManager>
  );
}

describe("URL workspace restoration", () => {
  it("runs an inactive panel action without switching layouts before the click", () => {
    seedTwoSessions();
    window.history.replaceState(null, "", "#/session/s1?pane=session:s1&pane=session:s2");
    render(<RoutedWorkspace />);
    const maximize = screen.getByRole("button", { name: "Maximize s2 panel" });
    fireEvent.pointerDown(maximize);
    fireEvent.focus(maximize);
    expect(parseHash(window.location.hash)).toMatchObject({ name: "session", id: "s1" });
    expect(panesStore.getState().panes.find((pane) => pane.focused)?.sessionId).toBe("s1");
    fireEvent.click(maximize);
    expect(panesStore.getState().maximizedPane).toBe("s2");
    expect(parseHash(window.location.hash)).toMatchObject({ name: "session", id: "s2" });
  });
  it("temporarily maximizes a panel without remounting its siblings or losing their drafts", () => {
    seedTwoSessions();
    window.history.replaceState(
      null,
      "",
      "#/session/s1?pane=session:s1&pane=session:s2&split=60&rows=65",
    );
    render(<RoutedWorkspace />);
    const editors = screen.getAllByRole("textbox");
    fireEvent.change(editors[1]!, { target: { value: "Draft in the other panel" } });
    const feedsClosed = sessionFeedMock.closeSession.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Maximize s1 panel" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(editors[1]?.isConnected).toBe(true);
    expect(panesStore.getState().panes).toHaveLength(2);
    expect(sessionFeedMock.closeSession.mock.calls).toHaveLength(feedsClosed);
    expect(parseHash(window.location.hash)).toMatchObject({
      workspace: { maximized: { kind: "session", id: "s1" }, splitRatio: 60, rowRatio: 65 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore panel layout" }));
    expect(screen.getAllByRole("textbox")[1]).toBe(editors[1]);
    expect((editors[1] as HTMLTextAreaElement).value).toBe("Draft in the other panel");
    expect(panesStore.getState().maximizedPane).toBeNull();
    expect(window.location.hash).not.toContain("zoom=");
    expect(panesStore.getState().splitRatio).toBe(60);
    expect(panesStore.getState().rowRatio).toBe(65);
  });
  it("restores row proportions and writes horizontal keyboard resizing to the URL", () => {
    window.history.replaceState(
      null,
      "",
      "#/session/s1?pane=session:s1&pane=session:s2&pane=session:s3&rows=60",
    );
    render(<RoutedWorkspace />);
    const rows = screen.getByRole("separator", { name: "Resize panel rows" });
    expect(rows.getAttribute("aria-orientation")).toBe("horizontal");
    expect(panesStore.getState().rowRatio).toBe(60);
    fireEvent.keyDown(rows, { key: "ArrowDown" });
    expect(parseHash(window.location.hash)).toMatchObject({ workspace: { rowRatio: 65 } });
    fireEvent.keyDown(rows, { key: "ArrowLeft" });
    expect(panesStore.getState().rowRatio).toBe(65);
    fireEvent.keyDown(rows, { key: "Home" });
    expect(panesStore.getState().rowRatio).toBe(30);
    fireEvent.keyDown(rows, { key: "End" });
    expect(panesStore.getState().rowRatio).toBe(70);
    fireEvent.doubleClick(rows);
    expect(panesStore.getState().rowRatio).toBe(50);
    expect(window.location.hash).not.toContain("rows=");
    expect(panesStore.getState().splitRatio).toBe(50);
  });
  it("restores panels before metadata arrives and retains order, focus and resizing", () => {
    window.history.replaceState(
      null,
      "",
      "#/session/s2?pane=session%3As1&pane=session%3As2&split=60",
    );
    const view = render(<RoutedWorkspace />);
    expect(view.container.querySelectorAll(".pane")).toHaveLength(2);
    expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual(["s1", "s2"]);
    expect(panesStore.getState().panes.find((pane) => pane.focused)?.sessionId).toBe("s2");
    expect(panesStore.getState().splitRatio).toBe(60);
    act(() => seedTwoSessions());
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("textbox")[0]!);
    expect(parseHash(window.location.hash)).toMatchObject({
      name: "session",
      id: "s1",
      workspace: { splitRatio: 60 },
    });
    act(() => panesStore.getState().setSplitRatio(55));
    expect(parseHash(window.location.hash)).toMatchObject({ workspace: { splitRatio: 55 } });
  });

  it("updates composition after closing a panel and removes it from the URL on single view", () => {
    seedTwoSessions();
    window.history.replaceState(null, "", "#/session/s1?pane=session%3As1&pane=session%3As2");
    render(<RoutedWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Close s2 panel" }));
    expect(parseHash(window.location.hash)).toMatchObject({
      workspace: { targets: [{ kind: "session", id: "s1" }] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Single view" }));
    expect(window.location.hash).toBe("#/session/s1");
    expect(panesStore.getState().panes).toHaveLength(0);
  });

  it("restores URL-only composition changes and plain links instead of overwriting them", async () => {
    seedTwoSessions();
    window.history.replaceState(null, "", "#/session/s1?pane=session%3As1&pane=session%3As2");
    render(<RoutedWorkspace />);
    act(() => {
      window.history.replaceState(null, "", "#/session/s1?pane=session%3As1&split=65");
      fireEvent(window, new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(panesStore.getState().panes).toHaveLength(1));
    expect(panesStore.getState().splitRatio).toBe(65);
    act(() => {
      window.history.replaceState(null, "", "#/session/s1");
      fireEvent(window, new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(panesStore.getState().panes).toHaveLength(0));
    expect(window.location.hash).toBe("#/session/s1");
  });
});

afterEach(() => {
  cleanup();
});

describe("PaneManager single session view", () => {
  it("keeps the single view intact when the split picker is cancelled", () => {
    seedTwoSessions();
    render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Split view" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(panesStore.getState().panes).toHaveLength(0);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", bubbles: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(held.get("s1")).toEqual(new Set(["session"]));
    expect(sessionFeedMock.closeSession).not.toHaveBeenCalled();
  });

  it("renders SessionView with feed and keepalive acquired from the route id alone", () => {
    seedSession({ id: "s1" });
    const { container, unmount } = render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    expect(container.querySelector(".panes")).toBeNull();
    expect(sessionFeedMock.ensureSession).toHaveBeenCalledWith("s1", "claude");
    expect(keepAliveMock.acquire).toHaveBeenCalledWith("s1", "session");
    unmount();
    expect(keepAliveMock.release).toHaveBeenCalledWith("s1", "session");
  });
});

describe("split mode", () => {
  it("transfers the transcript back to the single view without closing its feed", () => {
    seedTwoSessions();
    const { unmount } = render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT)));
    fireEvent.click(screen.getByRole("button", { name: "Close s2 panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Single view" }));
    expect(panesStore.getState().panes).toHaveLength(0);
    expect(held.get("s1")).toEqual(new Set(["session"]));
    expect(held.has("s2")).toBe(false);
    expect(sessionFeedMock.closeSession).not.toHaveBeenCalledWith("s1");
    unmount();
    expect(held.size).toBe(0);
  });

  it("keeps the current transcript when closing the last panel", () => {
    seedSession({ id: "s1" });
    render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT)));
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(panesStore.getState().panes).toHaveLength(0);
    expect(held.get("s1")).toEqual(new Set(["session"]));
    expect(sessionFeedMock.closeSession).not.toHaveBeenCalled();
  });

  it("opens panes for the viewed session and the most recent other session", () => {
    seedTwoSessions();
    render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    expect(keepAliveMock.acquire).toHaveBeenCalledWith("s1", "session");
    act(() => {
      window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT));
    });
    const ids = panesStore.getState().panes.map((pane) => pane.sessionId);
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
    expect(panesStore.getState().panes[0]?.focused).toBe(true);
    expect(keepAliveMock.acquire).toHaveBeenCalledWith("s1", "pane");
    expect(keepAliveMock.acquire).toHaveBeenCalledWith("s2", "pane");
    expect(sessionFeedMock.ensureSession).toHaveBeenCalledWith("s2", "codex");
    expect(screen.getAllByRole("textbox").length).toBe(2);
    expect(held.get("s1")).toEqual(new Set(["pane"]));
    expect(sessionFeedMock.closeSession).not.toHaveBeenCalled();
  });

  it("falls back to the current session only when it is the only session", () => {
    seedSession({ id: "s1" });
    render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT));
    });
    expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual(["s1"]);
  });

  it("ignores the split shortcut when the meta key is held", () => {
    seedTwoSessions();
    const unregister = registerWindowKeyboardShortcuts();
    render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          ctrlKey: true,
          metaKey: true,
          shiftKey: true,
          cancelable: true,
        }),
      );
    });
    expect(panesStore.getState().panes).toHaveLength(0);
    unregister();
  });

  it("keeps split mode and focuses an existing pane when navigating", () => {
    seedTwoSessions();
    const { rerender, unmount } = render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT)));
    rerender(
      <PaneManager deepLinkId="s2">
        <SessionView sessionId="s2" />
      </PaneManager>,
    );
    expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual(["s1", "s2"]);
    expect(panesStore.getState().panes.find((pane) => pane.focused)?.sessionId).toBe("s2");
    expect(held.get("s1")).toEqual(new Set(["pane"]));
    expect(held.get("s2")).toEqual(new Set(["pane"]));
    unmount();
    expect(held.size).toBe(0);
  });

  it("closes a pane from its close button and releases its keepalive", () => {
    seedTwoSessions();
    const { container } = render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT));
    });
    const closeButtons = screen.getAllByRole("button", { name: /^Close .* panel$/ });
    const secondClose = closeButtons[1];
    if (secondClose === undefined) {
      throw new Error("missing close button for the second pane");
    }
    act(() => {
      fireEvent.click(secondClose);
    });
    expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual(["s1"]);
    expect(keepAliveMock.release).toHaveBeenCalledWith("s2", "pane");
    expect(sessionFeedMock.closeSession).toHaveBeenCalledWith("s2");
    expect(held.has("s2")).toBe(false);
    expect(container.querySelectorAll(".pane")).toHaveLength(1);
  });

  it("releases every pane keepalive when PaneManager unmounts", () => {
    seedTwoSessions();
    const { unmount } = render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT));
    });
    unmount();
    expect(held.size).toBe(0);
  });
});

it("closes the editor the user clicked instead of the previously focused pane", () => {
  seedTwoSessions();
  render(<PaneManager deepLinkId="s1" />);
  act(() => window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT)));
  const editor = screen.getAllByRole("textbox")[1]!;
  fireEvent.click(editor);
  expect(panesStore.getState().panes.find((pane) => pane.focused)?.sessionId).toBe("s2");
  fireEvent.keyDown(editor, { key: "w", ctrlKey: true, bubbles: true });
  expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual(["s1"]);
});

it("preserves pending permission controls when switching to panels", () => {
  seedTwoSessions();
  approvalsStore.getState().ingestFrame({
    type: "approval.pending",
    topic: "session.s1",
    source: "claude",
    seq: 1,
    ts: Date.now(),
    approval_id: "permission",
    deadline: Date.now() + 60000,
    status: "pending",
    raw: { request: { tool_name: "Bash", input: { command: "echo synthetic" } } },
  });
  render(
    <PaneManager deepLinkId="s1">
      <SessionView sessionId="s1" />
    </PaneManager>,
  );
  expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
  act(() => window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT)));
  expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
});

it("replaces only the active panel when navigating to another conversation", () => {
  seedTwoSessions();
  seedSession({ id: "s3", lastActivityAt: 0 });
  const view = render(<PaneManager deepLinkId="s1" />);
  act(() => window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT)));
  view.rerender(<PaneManager deepLinkId="s3" />);
  expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual(["s2", "s3"]);
  expect(held.get("s1")).toBeUndefined();
  expect(held.get("s2")).toEqual(new Set(["pane"]));
});

it("offers classified root sessions without exposing native child duplicates", () => {
  seedTwoSessions();
  seedSession({ id: "native-child", lastActivityAt: 500 });
  agentsStore.setState({
    agents: {
      child: {
        id: "child",
        parent_session_id: "s2",
        parent_agent_id: null,
        session_id: "native-child",
        native_id: "child-native",
        harness: "claude",
        title: "Native reviewer",
        state: "completed",
        delegation_id: null,
        capabilities: { message: false, stop: false },
        created_at: 0,
        updated_at: 0,
      },
    },
    classifiedSessionIds: ["s1", "s2", "native-child"],
  });
  render(<PaneManager deepLinkId="s1" />);
  act(() => window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT)));
  expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual(["s1", "s2"]);
  fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]!);
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Native reviewer");
  expect(dialog.textContent).not.toContain("native-child");
});

it("groups the picker by sidebar folders and keeps native agents nested under their parent", () => {
  seedSession({
    id: "s1",
    title: "First root",
    projectPath: "/workspace/zeta",
    lastActivityAt: 300,
  });
  seedSession({
    id: "s2",
    title: "Other root",
    projectPath: "/workspace/alpha",
    lastActivityAt: 100,
  });
  const child = {
    id: "child",
    parent_session_id: "s1",
    parent_agent_id: null,
    session_id: null,
    native_id: "native-child",
    harness: "claude" as const,
    title: "Implementation",
    state: "running" as const,
    delegation_id: null,
    capabilities: { message: true, stop: true },
    created_at: 0,
    updated_at: 0,
  };
  agentsStore.setState({
    agents: {
      nested: { ...child, id: "nested", title: "Nested review", parent_agent_id: "child" },
      child,
    },
  });
  const select = vi.fn();
  render(
    <PanePicker
      currentTarget={{ kind: "session", id: "s1" }}
      onClose={vi.fn()}
      onSelect={select}
    />,
  );
  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
    "First root",
    "Implementation",
    "Nested review",
    "Other root",
  ]);
  expect((options[0] as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("zeta")).toBeTruthy();
  expect(screen.getByText("alpha")).toBeTruthy();
  expect(screen.queryByText("Choose a conversation")).toBeNull();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(select).toHaveBeenCalledWith({ kind: "agent", id: "nested" });
});

it("keeps the existing global search commands and keyboard selection", () => {
  const close = vi.fn();
  render(<CommandPalette open onClose={close} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "settings" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(close).toHaveBeenCalledOnce();
  expect(window.location.hash).toBe("#/settings");
});
