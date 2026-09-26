import { describe, expect, it } from "vitest";
import { DaemonError } from "@/daemon/errors";
import {
  OP_TIMEOUT_MS,
  OpManager,
  TopicSeqTracker,
  applySnapshot,
  gapToBookkeeping,
} from "@/daemon/ws/protocol";
import type { Clock } from "@/daemon/ws/protocol";
import type { GapMessage, GapReason, RuntimeStatus, SnapshotSession } from "@/daemon/types/ws";

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

  pendingCount(): number {
    return this.timers.length;
  }

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

function createTestClock(): FakeClock {
  return new FakeClock();
}

function createOpManager(clock: FakeClock): OpManager {
  let counter = 0;
  return new OpManager(clock, () => {
    counter += 1;
    return `op-${counter}`;
  });
}

describe("TopicSeqTracker", () => {
  it("sets baseline on first recorded sequence", () => {
    const tracker = new TopicSeqTracker();
    expect(tracker.record("sessions.all", 7)).toEqual({ ok: true, duplicate: false });
    expect(tracker.getSince("sessions.all")).toBe(7);
  });

  it("accepts in-order sequences", () => {
    const tracker = new TopicSeqTracker();
    tracker.record("t", 1);
    expect(tracker.record("t", 2)).toEqual({ ok: true, duplicate: false });
    expect(tracker.record("t", 3)).toEqual({ ok: true, duplicate: false });
    expect(tracker.getSince("t")).toBe(3);
  });

  it("flags duplicates without advancing state", () => {
    const tracker = new TopicSeqTracker();
    tracker.record("t", 5);
    expect(tracker.record("t", 5)).toEqual({ ok: true, duplicate: true });
    expect(tracker.record("t", 4)).toEqual({ ok: true, duplicate: true });
    expect(tracker.getSince("t")).toBe(5);
  });

  it("detects gaps with missing range and advances baseline", () => {
    const tracker = new TopicSeqTracker();
    tracker.record("t", 10);
    expect(tracker.record("t", 13)).toEqual({ ok: false, gap: { from: 11, to: 12 } });
    expect(tracker.getSince("t")).toBe(13);
    expect(tracker.record("t", 14)).toEqual({ ok: true, duplicate: false });
  });

  it("treats pre-gap sequences as duplicates after advancing", () => {
    const tracker = new TopicSeqTracker();
    tracker.record("t", 10);
    tracker.record("t", 13);
    expect(tracker.record("t", 12)).toEqual({ ok: true, duplicate: true });
  });

  it("tracks topics independently", () => {
    const tracker = new TopicSeqTracker();
    tracker.record("a", 1);
    tracker.record("b", 100);
    expect(tracker.record("b", 50)).toEqual({ ok: true, duplicate: true });
    expect(tracker.record("a", 2)).toEqual({ ok: true, duplicate: false });
    expect(tracker.getSince("a")).toBe(2);
    expect(tracker.getSince("b")).toBe(100);
  });

  it("returns undefined since for untracked topics", () => {
    const tracker = new TopicSeqTracker();
    expect(tracker.getSince("missing")).toBeUndefined();
  });

  it("resets all baselines for history_lost", () => {
    const tracker = new TopicSeqTracker();
    tracker.record("a", 3);
    tracker.record("b", 9);
    tracker.resetAll();
    expect(tracker.getSince("a")).toBeUndefined();
    expect(tracker.getSince("b")).toBeUndefined();
    expect(tracker.record("a", 1)).toEqual({ ok: true, duplicate: false });
  });

  it("resets a single topic without touching others", () => {
    const tracker = new TopicSeqTracker();
    tracker.record("a", 3);
    tracker.record("b", 9);
    tracker.reset("a");
    expect(tracker.getSince("a")).toBeUndefined();
    expect(tracker.getSince("b")).toBe(9);
  });
});

describe("OpManager", () => {
  it("creates request messages with unique op ids", () => {
    const ops = createOpManager(createTestClock());
    const first = ops.createOp("session.prompt", { session_id: "s1", content: "hi" });
    const second = ops.createOp("session.interrupt", { session_id: "s1" });
    expect(first.opId).toBe("op-1");
    expect(second.opId).toBe("op-2");
    expect(first.message).toEqual({
      type: "request",
      op_id: "op-1",
      action: "session.prompt",
      params: { session_id: "s1", content: "hi" },
    });
    expect(second.message).toEqual({
      type: "request",
      op_id: "op-2",
      action: "session.interrupt",
      params: { session_id: "s1" },
    });
  });

  it("rejects duplicate registration for an in-flight op id", () => {
    const ops = createOpManager(createTestClock());
    ops.registerOp(
      "op-1",
      () => undefined,
      () => undefined,
    );
    expect(() =>
      ops.registerOp(
        "op-1",
        () => undefined,
        () => undefined,
      ),
    ).toThrow(DaemonError);
    try {
      ops.registerOp(
        "op-1",
        () => undefined,
        () => undefined,
      );
    } catch (error) {
      expect((error as DaemonError).code).toBe("duplicate_op_id");
    }
  });

  it("resolves on successful response", async () => {
    const ops = createOpManager(createTestClock());
    const { opId } = ops.createOp("session.prompt", { session_id: "s1", content: "hi" });
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ops.registerOp(opId, resolve, reject);
    });
    expect(ops.handleResponse(opId, true, { session_id: "s1", state: "steered" }, null)).toBe(true);
    await expect(promise).resolves.toEqual({ session_id: "s1", state: "steered" });
  });

  it.each(["steer_unsupported", "plugin_llm_unsupported", "privacy_key_unavailable"])(
    "preserves %s domain errors in failed correlated responses",
    async (code) => {
      const ops = createOpManager(createTestClock());
      const { opId } = ops.createOp("session.prompt", { session_id: "s1", content: "hi" });
      const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
        ops.registerOp(opId, resolve, reject);
      });
      ops.handleResponse(opId, false, null, { code, message: "Selected operation unavailable" });
      await expect(promise).rejects.toBeInstanceOf(DaemonError);
      await expect(promise).rejects.toMatchObject({
        code,
        message: "Selected operation unavailable",
      });
    },
  );

  it("ignores responses for unknown op ids", () => {
    const ops = createOpManager(createTestClock());
    expect(ops.handleResponse("ghost", true, { anything: 1 }, null)).toBe(false);
  });

  it("keeps silent requests pending without an implicit deadline", async () => {
    const clock = createTestClock();
    const ops = createOpManager(clock);
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ops.registerOp("slow", resolve, reject);
    });
    clock.advance(24 * 60 * 60 * 1000);
    expect(clock.pendingCount()).toBe(0);
    expect(ops.expireOps(clock.now())).toBe(0);
    expect(ops.handleResponse("slow", true, { accepted: true }, null)).toBe(true);
    await expect(promise).resolves.toEqual({ accepted: true });
  });

  it("expires ops after the timeout using the injected clock", async () => {
    const clock = createTestClock();
    const ops = createOpManager(clock);
    const { opId } = ops.createOp("session.prompt", { session_id: "s1", content: "hi" });
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ops.registerOp(opId, resolve, reject, OP_TIMEOUT_MS);
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(DaemonError);
    clock.advance(OP_TIMEOUT_MS);
    await assertion;
    expect(ops.handleResponse(opId, true, { late: true }, null)).toBe(false);
  });

  it("does not expire resolved ops", async () => {
    const clock = createTestClock();
    const ops = createOpManager(clock);
    const { opId } = ops.createOp("session.prompt", { session_id: "s1", content: "hi" });
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ops.registerOp(opId, resolve, reject);
    });
    ops.handleResponse(opId, true, { done: true }, null);
    clock.advance(OP_TIMEOUT_MS * 2);
    await expect(promise).resolves.toEqual({ done: true });
    expect(clock.pendingCount()).toBe(0);
  });

  it("expireOps fires only due timeouts without relying on timers", async () => {
    const clock = createTestClock();
    const ops = createOpManager(clock);
    const { opId } = ops.createOp("session.prompt", { session_id: "s1", content: "hi" });
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ops.registerOp(opId, resolve, reject, OP_TIMEOUT_MS);
    });
    expect(ops.expireOps(clock.now() + OP_TIMEOUT_MS - 1)).toBe(0);
    const assertion = expect(promise).rejects.toBeInstanceOf(DaemonError);
    expect(ops.expireOps(clock.now() + OP_TIMEOUT_MS)).toBe(1);
    await assertion;
  });

  it("supports a custom timeout per op", async () => {
    const clock = createTestClock();
    const ops = createOpManager(clock);
    const { opId } = ops.createOp("approval.cancel", { approval_id: "a1" });
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ops.registerOp(opId, resolve, reject, 2500);
    });
    clock.advance(2500);
    await expect(promise).rejects.toBeInstanceOf(DaemonError);
  });
});

describe("applySnapshot", () => {
  it("passes through typed snapshot arrays as plain copies", () => {
    const sessions: SnapshotSession[] = [
      { id: "s1", harness: "claude", state: "live", title: "Session" },
    ];
    const runtimes: RuntimeStatus[] = [{ harness: "codex", installed: true, degraded: false }];
    const snapshot = applySnapshot(sessions, runtimes);
    expect(snapshot.sessions).toEqual(sessions);
    expect(snapshot.runtimes).toEqual(runtimes);
    expect(snapshot.sessions).not.toBe(sessions);
    expect(snapshot.runtimes).not.toBe(runtimes);
  });
});

describe("gapToBookkeeping", () => {
  it.each<GapReason>(["slow_consumer", "retention_exceeded", "history_lost"])(
    "maps %s gap frames to bookkeeping entries",
    (reason) => {
      const frame: GapMessage = {
        type: "gap",
        topic: "session.abc",
        from_seq: 3,
        seq: 9,
        reason,
      };
      expect(gapToBookkeeping(frame)).toEqual({ type: reason, topic: "session.abc" });
    },
  );
});
