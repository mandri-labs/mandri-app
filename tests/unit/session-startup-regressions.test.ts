import { beforeEach, expect, it, vi } from "vitest";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { withPendingUsers } from "@/features/transcript/optimistic";
import type { HarnessKind } from "@/daemon/types/ws";
import { isSessionWorking } from "@/features/transcript/turnActivity";

beforeEach(() => {
  sessionsStore.setState(sessionsStore.getInitialState());
  transcriptStore.getState().resetTranscripts();
});
const harnesses: HarnessKind[] = ["codex", "claude", "opencode", "agy"];
const visible = () => {
  const state = transcriptStore.getState().transcripts.s!;
  return withPendingUsers(state.nodes, state.pendingUsers ?? []);
};

it.each(harnesses)("%s keeps an unechoed startup prompt through feed teardown and empty history", async (harness) => {
  const service = new SessionFeedService({
    fetchHistoryPage: async () => ({ entries: [], next_cursor: null, has_more: false }),
    getSocket: () => null,
  });
  service.ensureSession("s", harness, { newSession: true });
  transcriptStore.getState().addPendingUser("s", "Hello");
  service.closeSession("s");
  service.ensureSession("s", harness);
  await service.loadHistory("s");
  transcriptStore.getState().setNodes("s", [{ kind: "assistant", text: "Hello back", key: "answer" }]);
  expect(visible()).toMatchObject([{ kind: "user", text: "Hello" }, { kind: "assistant", text: "Hello back" }]);
});

it.each(harnesses)("%s does not treat a live echo as proof that the prompt is persisted", async (harness) => {
  const service = new SessionFeedService({ getSocket: () => null });
  service.ensureSession("s", harness);
  const store = transcriptStore.getState();
  store.addPendingUser("s", "Hello");
  const echo = { kind: "user", text: "Hello", key: "echo" } as const;
  store.setNodes("s", [echo]);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(0);
  service.closeSession("s");
  service.ensureSession("s", harness);
  store.setNodes("s", [{ kind: "assistant", text: "Hello back" }], []);
  expect(visible().filter((node) => node.kind === "user")).toMatchObject([{ text: "Hello" }]);
  store.setNodes("s", [echo, { kind: "assistant", text: "Hello back" }], [echo]);
  expect(visible().filter((node) => node.kind === "user")).toHaveLength(1);
  expect(transcriptStore.getState().transcripts.s?.localUsers).toHaveLength(0);
  service.closeSession("s");
  expect(transcriptStore.getState().transcripts.s).toBeUndefined();
});

it.each(harnesses)("%s removes a rejected local prompt from retention", (harness) => {
  const service = new SessionFeedService({ getSocket: () => null });
  service.ensureSession("s", harness);
  const store = transcriptStore.getState();
  const key = store.addPendingUser("s", "Rejected");
  store.removePendingUser("s", key);
  service.closeSession("s");
  expect(transcriptStore.getState().transcripts.s).toBeUndefined();
});

it.each([undefined, "history"] as const)("process snapshots cannot interrupt observed work (source=%s)", (source) => {
  sessionsStore.setState({ sessions: { s: {
    id: "s", harness: "codex", state: "live", title: "External", deleted: false, pendingApprovals: 0,
    nativeTurnActive: true, nativeTurnStartedAt: 1000,
    turnWork: [{ id: "turn", source, startedAt: 1000 }],
  } } });
  const store = sessionsStore.getState();
  store.ingestFrame({ type: "snapshot", topic: "sessions.all", runtimes: [], sessions: [{ id: "s", harness: "codex", state: "stopped", title: "External" }] });
  store.applySessionPatch("s", { executionPhase: "stopped", externalBusy: true });
  const session = sessionsStore.getState().sessions.s!;
  expect(session.turnWork?.[0]).toEqual({ id: "turn", source, startedAt: 1000 });
  expect(session.nativeTurnActive).toBe(true);
  expect(isSessionWorking(session)).toBe(true);
});

it("only explicit interruption freezes a native turn as stopped", async () => {
  vi.spyOn(Date, "now").mockReturnValue(2000);
  sessionsStore.setState({ sessions: { s: {
    id: "s", harness: "codex", state: "live", title: "Work", deleted: false, pendingApprovals: 0,
    nativeTurnActive: true, turnWork: [{ id: "turn", startedAt: 1000 }],
  } } });
  const service = new SessionFeedService({ getSocket: () => ({ request: vi.fn().mockResolvedValue({ interrupted: true }) }) });
  expect(await service.interrupt("s")).toBe(true);
  expect(sessionsStore.getState().sessions.s?.turnWork?.[0]).toMatchObject({ endedAt: 2000, outcome: "stopped" });
  vi.restoreAllMocks();
});
