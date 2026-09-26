import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { ENTER_SPLIT_EVENT, registerWindowKeyboardShortcuts } from "@/app/keyboard";
import { PaneManager } from "@/app/panes/PaneManager";
import { SessionView } from "@/features/transcript/SessionView";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { panesStore } from "@/stores/panes";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import type { SessionView as SessionRow } from "@/stores/sessions";

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
  vi.clearAllMocks();
  held.clear();
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
  transcriptStore.getState().resetTranscripts();
  panesStore.setState({ panes: [], lastActionRejected: undefined });
});

afterEach(() => {
  cleanup();
});

describe("PaneManager single session view", () => {
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

  it("exits split mode when navigating to a different session and keeps releases balanced", () => {
    seedTwoSessions();
    const { rerender, unmount } = render(
      <PaneManager deepLinkId="s1">
        <SessionView sessionId="s1" />
      </PaneManager>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent(ENTER_SPLIT_EVENT));
    });
    expect(panesStore.getState().panes).toHaveLength(2);
    rerender(
      <PaneManager deepLinkId="s2">
        <SessionView sessionId="s2" />
      </PaneManager>,
    );
    expect(panesStore.getState().panes).toHaveLength(0);
    expect(keepAliveMock.release).toHaveBeenCalledWith("s1", "pane");
    expect(keepAliveMock.release).toHaveBeenCalledWith("s2", "pane");
    expect(sessionFeedMock.closeSession).toHaveBeenCalledWith("s1");
    expect(sessionFeedMock.closeSession).toHaveBeenCalledWith("s2");
    expect(sessionFeedMock.ensureSession).toHaveBeenCalledWith("s2", "codex");
    expect(keepAliveMock.acquire).toHaveBeenCalledWith("s2", "session");
    expect(held.get("s2")).toEqual(new Set(["session"]));
    unmount();
    expect(held.has("s2")).toBe(false);
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
    const closeButtons = screen.getAllByRole("button", { name: "Close focused pane" });
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
