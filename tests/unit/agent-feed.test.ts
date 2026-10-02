import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireAgentFeed, releaseAgentFeed, getAgentFeed } from "@/features/agents/agentFeed";
import { daemonIdentity } from "@/daemon/identity";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { paneKey, panesStore } from "@/stores/panes";

const socket = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  onFrame: vi.fn(() => vi.fn()),
}));
vi.mock("@/app/connection", () => ({ getDaemonSocket: () => socket }));
beforeEach(() => {
  daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
  vi.clearAllMocks();
  socket.request.mockResolvedValue({ entries: [], next_cursor: null, has_more: false });
  sessionsStore.setState({ sessions: {}, order: [] });
  transcriptStore.getState().resetTranscripts();
  panesStore.getState().closeAll();
});
afterEach(() => {
  releaseAgentFeed("child", "view");
  releaseAgentFeed("child", "pane");
});

it("retains the agent subscription while transferring a single view into a panel", async () => {
  acquireAgentFeed("child", "codex", "view");
  acquireAgentFeed("child", "codex", "pane");
  releaseAgentFeed("child", "view");
  expect(socket.subscribe).toHaveBeenCalledExactlyOnceWith("agent.child");
  expect(socket.unsubscribe).not.toHaveBeenCalled();
  await getAgentFeed().loadHistory("agent:child");
  expect(socket.request).toHaveBeenCalledWith("agent.history", {
    agent_id: "child",
    cursor: null,
    limit: expect.any(Number),
  });
  expect(sessionsStore.getState().sessions["agent:child"]).toBeUndefined();
  releaseAgentFeed("child", "pane");
  expect(socket.unsubscribe).toHaveBeenCalledExactlyOnceWith("agent.child");
  expect(transcriptStore.getState().transcripts["agent:child"]).toBeUndefined();
});

it("distinguishes a session target from an agent with the same id and enforces the panel limit", () => {
  const store = panesStore.getState();
  expect(store.openPane("same-id")).toBe(true);
  expect(store.openTarget({ kind: "agent", id: "same-id" })).toBe(true);
  expect(store.openPane("third")).toBe(true);
  expect(store.openPane("fourth")).toBe(true);
  expect(store.openPane("fifth")).toBe(false);
  expect(panesStore.getState().panes.map((pane) => pane.sessionId)).toEqual([
    "same-id",
    "agent:same-id",
    "third",
    "fourth",
  ]);
  expect(paneKey({ kind: "agent", id: "same-id" })).toBe("agent:same-id");
});

it("releases the previous daemon's agent feed before reusing an id on another daemon", () => {
  acquireAgentFeed("child", "codex", "pane");
  daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
  expect(socket.unsubscribe).toHaveBeenCalledWith("agent.child");
  acquireAgentFeed("child", "codex", "pane");
  expect(socket.subscribe).toHaveBeenCalledTimes(2);
});
