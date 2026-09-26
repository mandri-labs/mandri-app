import { describe, expect, it } from "vitest";
import type { FixtureFile, FixtureFrame, FixtureSummary } from "@/daemon/fixtures/load";
import {
  FixtureReplayer,
  fixtureToSessionSeed,
  listFixtures,
  loadFixture,
  replayHistory,
  validateFixtureFrames,
} from "@/daemon/fixtures";
import type { Clock } from "@/daemon/ws/protocol";
import type { EventMessage, HarnessKind, ServerMessage } from "@/daemon/types/ws";

interface FakeTimerEntry {
  id: number;
  at: number;
  fn: () => void;
}

class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private timers: FakeTimerEntry[] = [];

  readonly now = (): number => this.currentTime;

  readonly setTimeout = (handler: () => void, timeoutMs: number): unknown => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.push({ id, at: this.currentTime + timeoutMs, fn: handler });
    return id;
  };

  readonly clearTimeout = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };

  advance(stepMs: number): void {
    const target = this.currentTime + stepMs;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)
        .at(0);
      if (!due) {
        break;
      }
      this.currentTime = Math.max(this.currentTime, due.at);
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      due.fn();
    }
    this.currentTime = target;
  }
}

async function requireFixture(harness: HarnessKind, scenario: string): Promise<FixtureFile> {
  const fixture = await loadFixture(harness, scenario);
  if (fixture === null) {
    throw new Error(`missing fixture: ${harness}/${scenario}`);
  }
  return fixture;
}

function eventFrame(seq: number, ts: number): FixtureFrame {
  return {
    topic: "session.abc",
    seq,
    ts,
    frame: {
      topic: "session.abc",
      seq,
      source: "claude",
      raw: { text: "hello" },
      ts,
    },
  };
}

function stoppedFrame(ts: number): FixtureFrame {
  return {
    topic: "session.abc",
    seq: 9,
    ts,
    frame: {
      type: "session_stopped",
      topic: "session.abc",
      seq: 9,
      source: "mandri",
      raw: {
        session_id: "abc",
        harness: "claude",
        state: "stopped",
        cause: "viewer_stop",
      },
      ts,
    },
  };
}

function syntheticFixture(frames: FixtureFrame[]): FixtureFile {
  return {
    harness: "claude",
    scenario: "synthetic",
    modelRef: "openrouter/test/model",
    capturedAt: "2026-09-04T00:00:00.000Z",
    frames,
    history: { entries: ['{"ordinal":0}'] },
  };
}

function rawOf(frame: ServerMessage): unknown {
  return (frame as EventMessage).raw;
}

async function driveRealtime(clock: FakeClock, done: Promise<void>): Promise<void> {
  for (let step = 0; step < 64; step += 1) {
    let settled = false;
    void done.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    clock.advance(50);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (settled) {
      break;
    }
  }
  await done;
}

describe("fixture discovery", () => {
  it("discovers recorded fixtures and the synthetic Antigravity contract", () => {
    const fixtures = listFixtures();
    expect(fixtures).toHaveLength(13);
    expect(fixtures).toContainEqual({ harness: "agy", scenario: "chat" });
    const expected: FixtureSummary[] = [];
    for (const harness of ["claude", "codex", "opencode"] as const) {
      for (const scenario of ["approval", "chat", "error", "tools-diff"] as const) {
        expected.push({ harness, scenario });
      }
    }
    for (const summary of expected) {
      expect(fixtures).toContainEqual(summary);
    }
  });

  it("loads every fixture with matching identity and content", async () => {
    for (const { harness, scenario } of listFixtures()) {
      const fixture = await loadFixture(harness, scenario);
      expect(fixture).not.toBeNull();
      expect(fixture?.harness).toBe(harness);
      expect(fixture?.scenario).toBe(scenario);
      expect(fixture?.frames.length).toBeGreaterThan(0);
      expect(fixture?.modelRef).toContain("/");
      expect(Array.isArray(fixture?.history.entries)).toBe(true);
    }
  });

  it("returns null for unknown harness or scenario", async () => {
    expect(await loadFixture("claude", "does-not-exist")).toBeNull();
  });
});

describe("instant replay", () => {
  it("delivers every valid frame in order and reports no issues", async () => {
    for (const { harness, scenario } of listFixtures()) {
      const fixture = await requireFixture(harness, scenario);
      const delivered: ServerMessage[] = [];
      const replayer = new FixtureReplayer((frame) => {
        delivered.push(frame);
      });
      await replayer.replay(fixture, { speed: "instant" });
      const { frames } = validateFixtureFrames(fixture);
      expect(replayer.issues).toEqual([]);
      expect(delivered).toEqual(frames);
    }
  });
});

describe("invalid frame handling", () => {
  it("skips invalid frames and reports them as issues", async () => {
    const fixture = syntheticFixture([
      eventFrame(1, 100),
      { topic: null, seq: null, ts: 2, frame: { type: "mystery" } },
      { topic: null, seq: null, ts: 3, frame: "not-an-object" },
      eventFrame(2, 400),
    ]);
    const delivered: ServerMessage[] = [];
    const replayer = new FixtureReplayer((frame) => {
      delivered.push(frame);
    });
    await replayer.replay(fixture);
    expect(delivered).toHaveLength(2);
    expect(rawOf(delivered[0] as EventMessage)).toEqual({ text: "hello" });
    expect(replayer.issues).toEqual([
      { index: 1, reason: "invalid_frame", frame: { type: "mystery" } },
      { index: 2, reason: "invalid_frame", frame: "not-an-object" },
    ]);
  });
});

describe("realtime replay", () => {
  it("honors recorded timing scaled by timeScale with an injected clock", async () => {
    const clock = new FakeClock();
    const fixture = syntheticFixture([eventFrame(1, 1000), eventFrame(2, 2000), eventFrame(3, 3500)]);
    const delivered: ServerMessage[] = [];
    const marks: number[] = [];
    const replayer = new FixtureReplayer(
      (frame) => {
        marks.push(clock.now());
        delivered.push(frame);
      },
      { clock },
    );
    const done = replayer.replay(fixture, { speed: "realtime", timeScale: 0.1 });
    await driveRealtime(clock, done);
    expect(delivered).toHaveLength(3);
    expect(marks).toEqual([0, 100, 250]);
    expect(clock.now()).toBe(250);
    expect(replayer.issues).toEqual([]);
  });
});

describe("filter and maxFrames", () => {
  it("filters frames and caps the delivered count", async () => {
    const fixture = await requireFixture("claude", "chat");
    const delivered: ServerMessage[] = [];
    const replayer = new FixtureReplayer((frame) => {
      delivered.push(frame);
    });
    await replayer.replay(fixture, {
      filter: (frame) => "raw" in frame,
      maxFrames: 5,
    });
    expect(delivered).toHaveLength(5);
    for (const frame of delivered) {
      expect("raw" in frame).toBe(true);
    }
  });
});

describe("replayHistory", () => {
  it("returns history entries verbatim", async () => {
    const fixture = await requireFixture("codex", "chat");
    expect(replayHistory(fixture)).toEqual(fixture.history.entries);
    expect(replayHistory(fixture)).not.toBe(fixture.history.entries);
  });

  it("returns an empty list when history is unavailable", async () => {
    const fixture = await requireFixture("opencode", "error");
    expect(fixture.historyError).toMatchObject({ code: "harness_store_unavailable" });
    expect(replayHistory(fixture)).toEqual([]);
  });
});

describe("fixtureToSessionSeed", () => {
  it("derives a deterministic seed from harness and scenario", async () => {
    const fixture = await requireFixture("codex", "tools-diff");
    const seed = fixtureToSessionSeed(fixture);
    expect(seed).toEqual({
      id: "fixture-codex-tools-diff",
      harness: "codex",
      state: "live",
      title: "codex: Tools Diff",
    });
    const again = fixtureToSessionSeed(await requireFixture("codex", "tools-diff"));
    expect(again).toEqual(seed);
  });

  it("marks a fixture ending with session_stopped as stopped", async () => {
    const fixture = await requireFixture("claude", "chat");
    const withStop = syntheticFixture([...fixture.frames.slice(0, 2), stoppedFrame(999)]);
    const seed = fixtureToSessionSeed(withStop);
    expect(seed.state).toBe("stopped");
    expect(seed.title).toBe("claude: Synthetic");
  });
});
