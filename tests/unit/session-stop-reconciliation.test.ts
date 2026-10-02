import { beforeEach, expect, it, vi } from "vitest";
import { sessionsStore, transcriptStore, type SessionView } from "@/stores/sessions";
import { SessionFeedService, type HistoryPage } from "@/daemon/ws/sessionFeed";
import { isSessionBusy, isSessionWorking } from "@/features/transcript/turnActivity";
import { resumeSessionAction, stopSessionAction } from "@/features/sessions/lifecycle";
import { resumeSession, stopSession } from "@/daemon/rest/runtime";
import { getSessionAvailability, type SessionAvailability } from "@/daemon/rest/availability";
import { applyAvailability, refreshAvailability } from "@/features/sessions/availability";
import { daemonIdentity } from "@/daemon/identity";

vi.mock("@/daemon/rest/runtime", () => ({ resumeSession: vi.fn(), stopSession: vi.fn(), startSession: vi.fn() }));
vi.mock("@/daemon/rest/availability", () => ({ getSessionAvailability: vi.fn() }));
const free = { owner: "unowned" as const, activity: "idle" as const, can_resume: true, can_release: false, can_restore: false };
const seed: SessionView = { id: "s", harness: "codex", nativeId: "native", state: "live", title: "Synthetic", deleted: false,
  pendingApprovals: 0, nativeTurnActive: false, sending: false, awaitingResponse: false };
const native = (method: string, id: string, ts: number, seq: number) => ({ topic: "session.s" as const, source: "codex" as const, ts, seq,
  raw: { method, params: { threadId: "native", turn: { id, status: "completed" } } } });
const stopped = () => sessionsStore.getState().ingestFrame({ topic: "sessions.all", source: "mandri", ts: 500, seq: 100,
  raw: { type: "session_stopped", session_id: "s", cause: "viewer_stop" } });
beforeEach(() => {
  vi.resetAllMocks();
  daemonIdentity.setState((value) => ({ generation: value.generation + 1 }));
  sessionsStore.setState({ sessions: { s: { ...seed } }, order: ["s"] });
  transcriptStore.getState().resetTranscripts();
  vi.mocked(getSessionAvailability).mockResolvedValue(free);
  vi.mocked(stopSession).mockResolvedValue(undefined);
  vi.mocked(resumeSession).mockResolvedValue({ id: "s", harness: "codex", state: "live", project_path: "/synthetic", mode: null, gateway_route_id: null });
});

it("rejects a delayed Codex start across the global stop topic and closes history-derived work", () => {
  sessionsStore.getState().ingestFrame(native("turn/completed", "previous", 400, 3));
  sessionsStore.getState().applySessionPatch("s", { turnWork: [{ id: "incomplete-history", source: "history", startedAt: 425 }], nativeTurnActive: true });
  stopped();
  sessionsStore.getState().ingestFrame(native("turn/started", "delayed", 450, 4));
  sessionsStore.getState().ingestFrame(native("turn/started", "after-stop", 550, 5));
  const session = sessionsStore.getState().sessions.s!;
  expect(session).toMatchObject({ state: "stopped", nativeTurnActive: false, sending: false, awaitingResponse: false });
  expect(session.turnWork).toEqual([{ id: "incomplete-history", source: "history", startedAt: 425, endedAt: 500, outcome: "stopped" }]);
  expect(isSessionWorking(session)).toBe(false);
  expect(isSessionBusy(session)).toBe(false);
});

it("accepts native work after a live reconnect snapshot clears the client stop boundary", async () => {
  await stopSessionAction("s");
  sessionsStore.getState().ingestFrame({ type: "snapshot", topic: "sessions.all", runtimes: [], sessions: [{ id: "s", harness: "codex", state: "live", title: "Synthetic" }] });
  sessionsStore.getState().ingestFrame(native("turn/started", "reconnected", 600, 1));
  expect(sessionsStore.getState().sessions.s).toMatchObject({ state: "live", nativeTurnActive: true, lastStoppedAt: undefined });
});

it("does not append a running child tool after the controlled session has stopped", () => {
  const service = new SessionFeedService({ getSocket: () => null });
  service.ensureSession("s", "codex");
  stopped();
  service.ingestSessionFrame("s", "codex", { topic: "session.s", source: "codex", ts: 550, seq: 1,
    raw: { method: "item/started", params: { threadId: "native", item: { id: "late-tool", type: "commandExecution", command: "synthetic", status: "inProgress" } } } });
  expect(service.getNodes("s")).toContainEqual(expect.objectContaining({ kind: "tool", status: "cancelled" }));
});

it("keeps delayed final text and completion after global stop without reopening native activity", () => {
  const service = new SessionFeedService({ getSocket: () => null });
  service.ensureSession("s", "codex");
  stopped();
  const frames = [
    { topic: "session.s" as const, source: "codex" as const, ts: 550, seq: 1,
      raw: { method: "item/agentMessage/delta", params: { threadId: "native", itemId: "answer", delta: "Final result" } } },
    { topic: "session.s" as const, source: "codex" as const, ts: 551, seq: 2,
      raw: { method: "item/completed", params: { threadId: "native", item: { id: "answer", type: "agentMessage", text: "Final result" } } } },
    native("turn/completed", "finished", 552, 3),
  ];
  for (const frame of frames) {
    sessionsStore.getState().ingestFrame(frame);
    service.ingestSessionFrame("s", "codex", frame);
  }
  expect(service.getNodes("s")).toContainEqual(expect.objectContaining({ kind: "assistant", text: "Final result", streaming: false }));
  expect(sessionsStore.getState().sessions.s).toMatchObject({ state: "stopped", nativeTurnActive: false });
  expect(sessionsStore.getState().sessions.s?.turnWork).toBeUndefined();
  expect(isSessionBusy(sessionsStore.getState().sessions.s)).toBe(false);
});

it("does not resurrect work from history that was requested before stop while all flags were false", async () => {
  let resolve!: (page: HistoryPage) => void;
  const service = new SessionFeedService({ getSocket: () => null, fetchHistoryPage: () => new Promise((done) => { resolve = done; }) });
  service.ensureSession("s", "codex");
  const loading = service.loadHistory("s");
  stopped();
  resolve({ entries: [], next_cursor: null, has_more: false, turn_active: true });
  await loading;
  expect(sessionsStore.getState().sessions.s?.nativeTurnActive).toBe(false);
});

it("marks unfinished cold history as stopped without inventing its finish timestamp", async () => {
  sessionsStore.getState().applySessionPatch("s", { state: "stopped" });
  const service = new SessionFeedService({ getSocket: () => null, fetchHistoryPage: async () => ({
    entries: [JSON.stringify({ type: "event_msg", payload: { type: "task_started", turn_id: "historical" } })],
    next_cursor: null, has_more: false, turn_active: true,
  }) });
  service.ensureSession("s", "codex");
  await service.loadHistory("s");
  expect(sessionsStore.getState().sessions.s?.nativeTurnActive).toBe(false);
  expect(sessionsStore.getState().sessions.s?.turnWork).toEqual([expect.objectContaining({ outcome: "stopped", endedAt: undefined })]);
});

it("a repeated stopped snapshot clears leftover delivery flags", () => {
  sessionsStore.getState().applySessionPatch("s", { state: "stopped", sending: true, awaitingResponse: true });
  sessionsStore.getState().ingestFrame({ type: "snapshot", topic: "sessions.all", runtimes: [], sessions: [{ id: "s", harness: "codex", state: "stopped", title: "Synthetic" }] });
  expect(sessionsStore.getState().sessions.s).toMatchObject({ state: "stopped", sending: false, awaitingResponse: false });
});

it("invalidates a pre-stop ownership response and confirms unowned after successful stop", async () => {
  let finish!: (value: SessionAvailability) => void;
  vi.mocked(getSessionAvailability).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const loading = refreshAvailability("s");
  await stopSessionAction("s");
  await vi.waitFor(() => expect(sessionsStore.getState().sessions.s?.availability?.owner).toBe("unowned"));
  finish({ ...free, owner: "mandri" });
  await loading;
  expect(sessionsStore.getState().sessions.s).toMatchObject({ state: "stopped", availabilityStatus: "ready", availability: { owner: "unowned" } });
});

it("accepts a new turn after explicit resume even when the client stop clock is ahead", async () => {
  await stopSessionAction("s");
  expect(sessionsStore.getState().sessions.s?.lastStoppedAt).toBeGreaterThan(500);
  await resumeSessionAction("s");
  sessionsStore.getState().ingestFrame(native("turn/started", "resumed", 600, 1));
  expect(sessionsStore.getState().sessions.s).toMatchObject({ state: "live", nativeTurnActive: true, lastStoppedAt: undefined });
  expect(isSessionBusy(sessionsStore.getState().sessions.s)).toBe(true);
});

it("orders lifecycle events by their server timestamps without comparing the local stop clock", async () => {
  await stopSessionAction("s");
  sessionsStore.getState().ingestFrame({ topic: "sessions.all", source: "mandri", ts: 550, seq: 101,
    raw: { type: "session_stopped", session_id: "s", cause: "viewer_stop" } });
  expect(sessionsStore.getState().sessions.s?.lastStopCause).toBe("viewer_stop");
  sessionsStore.getState().ingestFrame({ topic: "sessions.all", source: "mandri", ts: 600, seq: 102,
    raw: { type: "session_started", session_id: "s", harness: "codex", state: "live" } });
  sessionsStore.getState().ingestFrame({ topic: "sessions.all", source: "mandri", ts: 575, seq: 103,
    raw: { type: "session_stopped", session_id: "s", cause: "crash" } });
  expect(sessionsStore.getState().sessions.s).toMatchObject({ state: "live", lastStopCause: "viewer_stop" });
});

it("a stopped reconnect snapshot clears owned pending work while confirmed external work survives", () => {
  sessionsStore.getState().applySessionPatch("s", { nativeTurnActive: true, sending: true, awaitingResponse: true, pendingApprovals: 1 });
  applyAvailability("s", { ...free, owner: "mandri", can_release: true });
  sessionsStore.getState().ingestFrame({ type: "snapshot", topic: "sessions.all", runtimes: [], sessions: [{ id: "s", harness: "codex", state: "stopped", title: "Synthetic" }] });
  expect(sessionsStore.getState().sessions.s).toMatchObject({ nativeTurnActive: false, sending: false, awaitingResponse: false, availabilityStatus: "stale" });
  expect(isSessionBusy(sessionsStore.getState().sessions.s)).toBe(false);
  expect(isSessionWorking({ ...sessionsStore.getState().sessions.s!, externalBusy: true })).toBe(true);
});

it("does not retain a busy dot after terminal execution suppresses native work", () => {
  const session = { ...seed, nativeTurnActive: true, executionPhase: "stopped" };
  expect(isSessionWorking(session)).toBe(false);
  expect(isSessionBusy(session)).toBe(false);
});
