import { beforeEach, describe, expect, it } from "vitest";
import type { FixtureFile } from "@/daemon/fixtures/load";
import { loadFixture } from "@/daemon/fixtures/load";
import { FixtureReplayer, fixtureToSessionSeed } from "@/daemon/fixtures/replay";
import type {
  EventMessage,
  HarnessKind,
  ServerMessage,
  SessionStopCause,
  SnapshotMessage,
  SnapshotSession,
  WsTopic,
} from "@/daemon/types/ws";
import { registerIngest, dispatchFrame, resetIngests } from "@/app/framePipeline";
import {
  selectByProject,
  selectVisibleSessions,
  sessionsStore,
  UNGROUPED_PROJECT,
} from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";

const SCENARIOS: Record<HarnessKind, string> = {
  pi: "chat",
  claude: "chat",
  codex: "tools-diff",
  agy: "chat",
  opencode: "approval",
};

async function requireFixture(harness: HarnessKind): Promise<FixtureFile> {
  const fixture = await loadFixture(harness, SCENARIOS[harness]);
  if (fixture === null) {
    throw new Error(`missing fixture: ${harness}/${SCENARIOS[harness]}`);
  }
  return fixture;
}

function snapshotFrame(sessions: SnapshotSession[]): SnapshotMessage {
  return { type: "snapshot", topic: "sessions.all", sessions, runtimes: [] };
}

function lifecycleFrame(
  topic: WsTopic,
  seq: number,
  ts: number,
  payload: Record<string, unknown>,
): EventMessage {
  return { topic, seq, source: "mandri", raw: payload, ts };
}

function stoppedFrame(
  sessionId: string,
  cause: SessionStopCause,
  seq: number,
  ts: number,
): ServerMessage {
  return {
    type: "session_stopped",
    topic: `session.${sessionId}`,
    seq,
    source: "mandri",
    raw: { session_id: sessionId, harness: "claude", state: "stopped", cause },
    ts,
  };
}

function seed(
  id: string,
  harness: HarnessKind,
  state: "stopped" | "live" | "discovered",
  title: string,
): SnapshotSession {
  return { id, harness, state, title };
}

function viewOf(id: string): SessionView {
  const session = sessionsStore.getState().sessions[id];
  if (session === undefined) {
    throw new Error(`session not registered: ${id}`);
  }
  return session;
}

beforeEach(() => {
  resetIngests();
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
});

it("rejects stale turn events after metadata updates and a reconnect snapshot", () => {
  const store = sessionsStore.getState();
  const session = seed("s", "claude", "live", "Session");
  const start: EventMessage = {
    topic: "session.s",
    source: "claude",
    seq: 5,
    ts: 100,
    raw: { type: "assistant", message: { id: "message" } },
  };
  store.ingestFrame(snapshotFrame([session]));
  store.ingestFrame(start);
  store.renameLocal("s", "Renamed");
  store.ingestFrame({ ...start, seq: 4, ts: 90, raw: { type: "result" } });
  expect(viewOf("s").nativeTurnActive).toBe(true);
  store.ingestFrame({ ...start, seq: 6, ts: 110, raw: { type: "result" } });
  store.ingestFrame(snapshotFrame([session]));
  store.ingestFrame(start);
  expect(viewOf("s").nativeTurnActive).toBe(false);
});

describe("fixture replay into sessions store", () => {
  it("registers each harness fixture session via a synthetic snapshot then replays its frames", async () => {
    for (const harness of ["claude", "codex", "opencode", "agy"] as const) {
      const fixture = await requireFixture(harness);
      const expected = fixtureToSessionSeed(fixture);
      sessionsStore.getState().ingestFrame(snapshotFrame([expected]));
      const replayer = new FixtureReplayer((frame) => {
        sessionsStore.getState().ingestFrame(frame);
      });
      await replayer.replay(fixture, { speed: "instant" });
      expect(replayer.issues).toEqual([]);
      const view = viewOf(expected.id);
      expect(view.harness).toBe(expected.harness);
      expect(view.state).toBe(expected.state);
      expect(view.title).toBe(expected.title);
      expect(view.deleted).toBe(false);
      expect(view.pendingApprovals).toBe(0);
      expect(selectVisibleSessions(sessionsStore.getState())).toHaveLength(1);
    }
  });

  it("leaves the registry intact when replaying transcript-only frames", async () => {
    const fixture = await requireFixture("claude");
    const expected = fixtureToSessionSeed(fixture);
    sessionsStore.getState().ingestFrame(snapshotFrame([expected]));
    const replayer = new FixtureReplayer((frame) => {
      sessionsStore.getState().ingestFrame(frame);
    });
    await replayer.replay(fixture, { speed: "instant" });
    expect(Object.keys(sessionsStore.getState().sessions)).toEqual([expected.id]);
  });
});

describe("lifecycle ingestion", () => {
  it("applies activity transitions with last activity timestamps", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(snapshotFrame([seed("s1", "claude", "live", "S1")]));
    store.ingestFrame(
      lifecycleFrame("sessions.all", 1, 100, {
        type: "activity",
        session_id: "s1",
        harness: "claude",
        activity: "active",
        last_activity_at: 111,
      }),
    );
    expect(viewOf("s1").activity).toBe("active");
    expect(viewOf("s1").lastActivityAt).toBe(111);
    store.ingestFrame(
      lifecycleFrame("session.s1", 2, 120, {
        type: "activity",
        session_id: "s1",
        harness: "claude",
        activity: "idle",
        last_activity_at: 119,
      }),
    );
    expect(viewOf("s1").activity).toBe("idle");
    expect(viewOf("s1").lastActivityAt).toBe(119);
  });

  it("applies state transitions from sessions.all and per-session topics", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(snapshotFrame([seed("s1", "codex", "discovered", "S1")]));
    store.ingestFrame(
      lifecycleFrame("sessions.all", 1, 100, {
        type: "session_state",
        session_id: "s1",
        harness: "codex",
        state: "live",
      }),
    );
    expect(viewOf("s1").state).toBe("live");
    store.ingestFrame(
      lifecycleFrame("session.s1", 2, 110, {
        type: "session_state",
        session_id: "s1",
        harness: "codex",
        state: "stopped",
      }),
    );
    expect(viewOf("s1").state).toBe("stopped");
  });

  it("retains the stop cause from session_stopped frames and lifecycle events", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(snapshotFrame([seed("s1", "claude", "live", "S1")]));
    store.ingestFrame(stoppedFrame("s1", "crash", 5, 200));
    expect(viewOf("s1").state).toBe("stopped");
    expect(viewOf("s1").lastStopCause).toBe("crash");
    store.ingestFrame(
      lifecycleFrame("sessions.all", 6, 210, {
        type: "session_stopped",
        session_id: "s1",
        harness: "claude",
        state: "stopped",
        cause: "viewer_stop",
      }),
    );
    expect(viewOf("s1").lastStopCause).toBe("viewer_stop");
  });

  it("registers discovered sessions from session_started events", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(
      lifecycleFrame("sessions.all", 1, 100, {
        type: "session_started",
        session_id: "new-1",
        harness: "opencode",
        state: "discovered",
      }),
    );
    const view = viewOf("new-1");
    expect(view.harness).toBe("opencode");
    expect(view.state).toBe("discovered");
    expect(view.title.length).toBeGreaterThan(0);
  });
});

describe("snapshot replacement", () => {
  it("replaces the whole registry on a new sessions.all snapshot", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(
      snapshotFrame([seed("a", "claude", "live", "A"), seed("b", "codex", "stopped", "B")]),
    );
    store.ingestFrame(snapshotFrame([seed("c", "opencode", "live", "C")]));
    expect(sessionsStore.getState().order).toEqual(["c"]);
    expect(selectVisibleSessions(sessionsStore.getState()).map((s) => s.id)).toEqual(["c"]);
  });
});

describe("deleted exclusion", () => {
  it("hides tombstoned sessions from selectors but keeps the registry entry", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(
      snapshotFrame([seed("a", "claude", "live", "A"), seed("b", "codex", "live", "B")]),
    );
    sessionsStore.getState().markDeleted("a");
    expect(viewOf("a").deleted).toBe(true);
    expect(selectVisibleSessions(sessionsStore.getState()).map((s) => s.id)).toEqual(["b"]);
    expect(selectByProject(sessionsStore.getState()).flatMap((g) => g.sessions)).toHaveLength(1);
  });
});

describe("filters and sorting", () => {
  it("filters by harness, state, and text", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(
      snapshotFrame([
        seed("claude-1", "claude", "live", "Alpha build"),
        seed("codex-1", "codex", "stopped", "Beta refactor"),
        seed("claude-2", "claude", "discovered", "Gamma scan"),
      ]),
    );
    store.setFilters({ harness: "claude" });
    expect(selectVisibleSessions(sessionsStore.getState()).map((s) => s.id)).toEqual([
      "claude-1",
      "claude-2",
    ]);
    store.setFilters({ harness: "claude", state: "live" });
    expect(selectVisibleSessions(sessionsStore.getState()).map((s) => s.id)).toEqual(["claude-1"]);
    store.setFilters({ text: "beta" });
    expect(selectVisibleSessions(sessionsStore.getState()).map((s) => s.id)).toEqual(["codex-1"]);
    store.clearFilters();
    expect(selectVisibleSessions(sessionsStore.getState())).toHaveLength(3);
  });

  it("sorts by last activity descending", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(
      snapshotFrame([seed("old", "claude", "live", "Old"), seed("new", "codex", "live", "New")]),
    );
    store.ingestFrame(
      lifecycleFrame("sessions.all", 1, 100, {
        type: "activity",
        session_id: "old",
        harness: "claude",
        activity: "idle",
        last_activity_at: 10,
      }),
    );
    store.ingestFrame(
      lifecycleFrame("sessions.all", 2, 100, {
        type: "activity",
        session_id: "new",
        harness: "codex",
        activity: "active",
        last_activity_at: 90,
      }),
    );
    expect(selectVisibleSessions(sessionsStore.getState()).map((s) => s.id)).toEqual([
      "new",
      "old",
    ]);
  });
});

describe("REST hydration", () => {
  it("maps snake_case SessionOut payloads into camelCase views", () => {
    sessionsStore.getState().upsertFromRest([
      {
        id: "r1",
        harness: "codex",
        native_id: null,
        title: "Rest session",
        project_path: "D:/Dev/demo",
        created_at: 1,
        updated_at: 2,
        state: "live",
        model: "openrouter/gpt",
        activity: "idle",
        last_activity_at: 42,
      },
    ]);
    const view = viewOf("r1");
    expect(view.projectPath).toBe("D:/Dev/demo");
    expect(view.lastActivityAt).toBe(42);
    expect(view.model).toBe("openrouter/gpt");
    expect(view.activity).toBe("idle");
    expect(view.state).toBe("live");
  });

  it("preserves derived fields across re-hydration", () => {
    sessionsStore.getState().upsertFromRest([
      {
        id: "r1",
        harness: "claude",
        native_id: null,
        title: "Rest session",
        project_path: "",
        created_at: 1,
        updated_at: 2,
        state: "stopped",
        model: null,
      },
    ]);
    sessionsStore.getState().setPendingApprovals("r1", 2);
    sessionsStore.getState().upsertFromRest([
      {
        id: "r1",
        harness: "claude",
        native_id: null,
        title: "Rest session renamed",
        project_path: "",
        created_at: 1,
        updated_at: 3,
        state: "stopped",
        model: null,
      },
    ]);
    const view = viewOf("r1");
    expect(view.pendingApprovals).toBe(2);
    expect(view.title).toBe("Rest session renamed");
    expect(view.projectPath).toBeUndefined();
  });
});

describe("project grouping", () => {
  it("groups sessions by project path with ungrouped sessions last", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(
      snapshotFrame([
        seed("ungrouped", "claude", "live", "Floating"),
        seed("p1", "codex", "live", "One"),
        seed("p2", "claude", "live", "Two"),
      ]),
    );
    store.renameLocal("p1", "One");
    sessionsStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        p1: { ...viewOf("p1"), projectPath: "D:/Dev/one" },
        p2: { ...viewOf("p2"), projectPath: "D:/Dev/two" },
      },
    }));
    const groups = selectByProject(sessionsStore.getState());
    expect(groups.map((g) => g.project)).toEqual(["D:/Dev/one", "D:/Dev/two", UNGROUPED_PROJECT]);
    expect(groups[2]?.sessions.map((s) => s.id)).toEqual(["ungrouped"]);
  });
});

describe("local mutations", () => {
  it("renames locally", () => {
    const store = sessionsStore.getState();
    store.ingestFrame(snapshotFrame([seed("a", "claude", "live", "Before")]));
    store.renameLocal("a", "After");
    expect(viewOf("a").title).toBe("After");
  });
});

describe("frame pipeline wiring", () => {
  it("keeps core ingestion active after an optional subscriber unregisters", () => {
    let received = 0;
    const unregister = registerIngest((frame) => {
      if ("type" in frame && frame.type === "snapshot") received += 1;
    });
    dispatchFrame(snapshotFrame([seed("w1", "claude", "live", "Wired")]));
    expect(viewOf("w1").title).toBe("Wired");
    expect(received).toBe(1);
    unregister();
    dispatchFrame(snapshotFrame([seed("w2", "claude", "live", "Wired 2")]));
    expect(viewOf("w2").title).toBe("Wired 2");
    expect(received).toBe(1);
  });
});
