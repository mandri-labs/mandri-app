import { beforeEach, expect, it } from "vitest";
import type { HarnessKind } from "@/daemon/types/ws";
import { sessionsStore } from "@/stores/sessions";
import { isSessionWorking, nativeTurnActivity } from "@/features/transcript/turnActivity";

beforeEach(() => sessionsStore.setState({ sessions: {}, order: [] }));

const endings: [HarnessKind, unknown][] = [
  ["opencode", { type: "session.idle", properties: { sessionID: "native" } }],
  ["opencode", { type: "session.status", properties: { sessionID: "native", status: { type: "idle" } } }],
  ["claude", { type: "result", session_id: "native", subtype: "success" }],
  ["codex", { method: "turn/completed", params: { threadId: "native", turn: { status: "completed" } } }],
];

it.each(endings)("%s ends the indicator before delivery acknowledgement and ignores stale activity", (harness, raw) => {
  const store = sessionsStore.getState();
  sessionsStore.setState({ sessions: { s1: {
    id: "s1", harness, nativeId: "native", state: "live", title: "Test", deleted: false,
    pendingApprovals: 0, activity: "active", sending: true, awaitingResponse: true,
  } } });
  expect(isSessionWorking(sessionsStore.getState().sessions.s1)).toBe(true);
  store.ingestFrame({ topic: "session.s1", seq: 1, source: harness, raw, ts: 1 });
  expect(isSessionWorking(sessionsStore.getState().sessions.s1)).toBe(false);
  expect(sessionsStore.getState().sessions.s1?.awaitingResponse).toBe(false);
  store.applySessionPatch("s1", { sending: false, activity: "active" });
  expect(isSessionWorking(sessionsStore.getState().sessions.s1)).toBe(false);
  store.applySessionPatch("s1", { sending: true, awaitingResponse: true, nativeTurnActive: undefined });
  expect(isSessionWorking(sessionsStore.getState().sessions.s1)).toBe(true);
});

it.each([
  ["opencode", { type: "session.idle", properties: { sessionID: "child" } }],
  ["claude", { type: "result", session_id: "native", parent_tool_use_id: "child" }],
  ["claude", { type: "result", session_id: "child" }],
  ["codex", { method: "turn/completed", params: { threadId: "child" } }],
] satisfies [HarnessKind, unknown][])("%s ignores child completion", (harness, raw) => {
  expect(nativeTurnActivity(harness, "native", raw)).toBeUndefined();
});

it("keeps Claude active with queued turns and ignores intermediate message completion", () => {
  expect(nativeTurnActivity("claude", "native", { type: "result", queued_turn_count: 1 })).toBe(true);
  expect(nativeTurnActivity("claude", "native", { type: "stream_event", event: { type: "message_stop" } })).toBeUndefined();
  expect(nativeTurnActivity("claude", "native", { type: "assistant" })).toBe(true);
  expect(nativeTurnActivity("claude", "native", { type: "result", is_error: true })).toBe(false);
});

it("uses turn boundaries, not completed tools or maintenance events", () => {
  expect(nativeTurnActivity("codex", "native", { method: "item/completed" })).toBeUndefined();
  expect(nativeTurnActivity("codex", "native", { method: "turn/started", params: { threadId: "native" } })).toBe(true);
  expect(nativeTurnActivity("opencode", "native", { type: "server.heartbeat" })).toBeUndefined();
  for (const status of ["busy", "retry"]) {
    expect(nativeTurnActivity("opencode", "native", { type: "session.status", properties: { sessionID: "native", status: { type: status } } })).toBe(true);
  }
});


it("stops Codex activity on a non-retryable error and preserves retries", () => {
  expect(nativeTurnActivity("codex", "native", { method: "error", params: { threadId: "native", willRetry: false } })).toBe(false);
  expect(nativeTurnActivity("codex", "native", { method: "error", params: { threadId: "native", willRetry: true } })).toBeUndefined();
});

it.each(["failed", "blocked", "stopped"])("does not keep stale native activity spinning after %s", (executionPhase) => {
  expect(isSessionWorking({ id: "s1", harness: "codex", state: "live", title: "Test", deleted: false, pendingApprovals: 0, nativeTurnActive: true, executionPhase })).toBe(false);
});
