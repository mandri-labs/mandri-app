import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { SessionView } from "@/features/transcript/SessionView";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { panesStore } from "@/stores/panes";
import { displayPreferencesStore } from "@/stores/displayPreferences";
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

vi.mock("@/daemon/ws/keepAlive", () => ({
  keepAlive: {
    acquire: vi.fn(),
    release: vi.fn(),
    isHeld: vi.fn(() => false),
    forget: vi.fn(),
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

beforeAll(async () => {
  await initI18n("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  displayPreferencesStore.setState(displayPreferencesStore.getInitialState());
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
  transcriptStore.getState().resetTranscripts();
  panesStore.setState({ panes: [], lastActionRejected: undefined });
});

afterEach(() => {
  cleanup();
});

describe("SessionView", () => {
  it("applies width changes immediately to the current conversation", () => {
    seedSession({ id: "s1" });
    const { container } = render(<SessionView sessionId="s1" />);
    const view = container.querySelector(".session-view")!;
    expect(view.getAttribute("data-conversation-width")).toBe("standard");
    for (const width of ["wide", "full", "standard"] as const) {
      act(() => displayPreferencesStore.getState().setConversationWidth(width));
      expect(view.getAttribute("data-conversation-width")).toBe(width);
    }
  });
  it("ensures the feed and acquires keepalive on mount, releases on unmount", () => {
    seedSession({ id: "s1", harness: "claude", state: "live" });
    const { unmount } = render(<SessionView sessionId="s1" />);
    expect(sessionFeedMock.ensureSession).toHaveBeenCalledWith("s1", "claude");
    expect(keepAliveMock.acquire).toHaveBeenCalledWith("s1", "session");
    unmount();
    expect(keepAliveMock.release).toHaveBeenCalledWith("s1", "session");
    expect(sessionFeedMock.closeSession).toHaveBeenCalledWith("s1");
  });

  it("renders the transcript and the composer in one column", () => {
    seedSession({ id: "s1", harness: "claude", state: "live" });
    const { container } = render(<SessionView sessionId="s1" />);
    expect(container.querySelector(".transcript")).not.toBeNull();
    expect(container.querySelector(".composer")).not.toBeNull();
    expect(container.querySelector(".session-view-column")).not.toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders nothing to subscribe when the session is unknown yet", () => {
    const { container } = render(<SessionView sessionId="missing" />);
    expect(sessionFeedMock.ensureSession).not.toHaveBeenCalled();
    expect(keepAliveMock.acquire).not.toHaveBeenCalled();
    expect(container.querySelector(".composer")).toBeNull();
  });

  it("renders the lifecycle status row for a loaded session", () => {
    seedSession({ id: "s1", harness: "claude", state: "live" });
    render(<SessionView sessionId="s1" />);
    expect(screen.getByRole("toolbar", { name: "Session actions" })).toBeTruthy();
  });
});
