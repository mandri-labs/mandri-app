import { beforeEach, expect, it, vi } from "vitest";
import { dispatchFrame } from "@/app/framePipeline";
import { refreshSessionMetadata } from "@/app/sessionSync";
import { listSessions } from "@/daemon/rest/sessions";
import { sessionsStore } from "@/stores/sessions";

vi.mock("@/daemon/rest/sessions", () => ({ listSessions: vi.fn() }));
vi.mock("@/app/connection", () => ({
  getDaemonSocket: () => ({
    request: async () => ({ sessions: await listSessions() }),
  }),
}));
const row = {
  id: "s1",
  harness: "claude",
  state: "live",
  title: "Session",
  native_id: "native",
  project_path: "/workspace",
  model: null,
  activity: "idle",
  last_activity_at: 1,
};

beforeEach(() => {
  vi.mocked(listSessions).mockResolvedValue([]);
  sessionsStore.setState({ sessions: {}, order: [] });
});

it("ingests snapshots and lifecycle events without a mounted dashboard", async () => {
  dispatchFrame({
    type: "snapshot",
    topic: "sessions.all",
    sessions: [{ id: "s1", harness: "claude", state: "live", title: "Session" }],
    runtimes: [],
  });
  dispatchFrame({
    topic: "sessions.all",
    seq: 1,
    source: "mandri",
    ts: 1,
    raw: { type: "session_stopped", session_id: "s1", cause: "viewer_stop" },
  });
  expect(sessionsStore.getState().sessions.s1?.state).toBe("stopped");
  await Promise.resolve();
});

it("loads resumability metadata without overwriting a newer lifecycle event", async () => {
  sessionsStore
    .getState()
    .upsertFromRest([row as Awaited<ReturnType<typeof listSessions>>[number]]);
  let finish!: (rows: Awaited<ReturnType<typeof listSessions>>) => void;
  vi.mocked(listSessions).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = refreshSessionMetadata();
  sessionsStore.getState().ingestFrame({
    topic: "sessions.all",
    seq: 1,
    source: "mandri",
    ts: 1,
    raw: { type: "session_stopped", session_id: "s1", cause: "viewer_stop" },
  });
  finish([
    { ...row, native_id: "updated-native" } as Awaited<ReturnType<typeof listSessions>>[number],
  ]);
  await loading;
  expect(sessionsStore.getState().sessions.s1).toMatchObject({
    state: "stopped",
    nativeId: "updated-native",
  });
});

it("repairs stale lifecycle metadata when no lifecycle transition occurs during the lookup", async () => {
  sessionsStore
    .getState()
    .upsertFromRest([
      { ...row, activity: "active" } as Awaited<ReturnType<typeof listSessions>>[number],
    ]);
  vi.mocked(listSessions).mockResolvedValue([
    { ...row, state: "stopped" } as Awaited<ReturnType<typeof listSessions>>[number],
  ]);
  await refreshSessionMetadata();
  expect(sessionsStore.getState().sessions.s1).toMatchObject({
    state: "stopped",
    activity: "idle",
    nativeTurnActive: false,
  });
});
