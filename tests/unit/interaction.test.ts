import { describe, expect, it } from "vitest";
import { OP_TIMEOUT_MS, OpManager } from "@/daemon/ws/protocol";
import type { Clock } from "@/daemon/ws/protocol";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import type { RequestParamsOf } from "@/daemon/ws/protocol";
import type { ActionResultMap, ProtocolErrorCode, RequestAction } from "@/daemon/types/ws";

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

interface SentRequest {
  opId: string;
  action: RequestAction;
  params: Record<string, unknown>;
}

class FakeSocket {
  private readonly clock: Clock;
  private readonly ops: OpManager;
  private counter = 0;
  readonly sent: SentRequest[] = [];

  constructor(clock: Clock) {
    this.clock = clock;
    this.ops = new OpManager(this.clock, () => {
      this.counter += 1;
      return `op-${this.counter}`;
    });
  }

  request<A extends RequestAction>(
    action: A,
    params: RequestParamsOf<A>,
  ): Promise<ActionResultMap[A]> {
    const { opId } = this.ops.createOp(action, params);
    this.sent.push({ opId, action, params: params as unknown as Record<string, unknown> });
    return new Promise((resolve, reject) => {
      this.ops.registerOp(opId, resolve as (result: Record<string, unknown>) => void, reject);
    });
  }

  respondOk(opId: string, result: Record<string, unknown>): void {
    this.ops.handleResponse(opId, true, result, null);
  }

  respondError(opId: string, code: ProtocolErrorCode, message: string): void {
    this.ops.handleResponse(opId, false, null, { code, message });
  }

  lastOpId(): string {
    const last = this.sent.at(-1);
    if (last === undefined) {
      throw new Error("no request sent");
    }
    return last.opId;
  }
}

function setup(socket: FakeSocket | null): SessionFeedService {
  return new SessionFeedService({
    getSocket: () => socket,
    fetchHistoryPage: async () => ({ entries: [], next_cursor: null, has_more: false }),
  });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
}

describe("session feed interaction ops", () => {
  it("sends session.prompt and records a queued outcome", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.sendPrompt("session-1", "hello there");
    expect(socket.sent).toEqual([
      {
        opId: "op-1",
        action: "session.prompt",
        params: { session_id: "session-1", content: "hello there" },
      },
    ]);
    socket.respondOk(socket.lastOpId(), { session_id: "session-1", state: "queued", code: null });
    await expect(pending).resolves.toEqual({ state: "queued", code: null });
    expect(service.getPromptOutcome("session-1")).toEqual({ state: "queued", code: null });
  });

  it("records a steered outcome with a delivery code", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.sendPrompt("session-1", "follow-up");
    socket.respondOk(socket.lastOpId(), { session_id: "session-1", state: "steered", code: null });
    await expect(pending).resolves.toEqual({ state: "steered", code: null });
    expect(service.getPromptOutcome("session-1")).toEqual({ state: "steered", code: null });
  });

  it("propagates prompt protocol errors without recording an outcome", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.sendPrompt("session-1", "boom");
    socket.respondError(socket.lastOpId(), "steer_unsupported", "harness cannot steer");
    const error = await failureOf(pending);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code: string }).code).toBe("steer_unsupported");
    expect(service.getPromptOutcome("session-1")).toBeUndefined();
  });

  it("waits for an acknowledged prompt beyond the previous timeout", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.sendPrompt("session-1", "slow");
    clock.advance(OP_TIMEOUT_MS);
    expect(service.getPromptOutcome("session-1")).toBeUndefined();
    socket.respondOk(socket.lastOpId(), { state: "queued", code: null });
    await expect(pending).resolves.toEqual({ state: "queued", code: null });
  });

  it("rejects ops when no socket is available", async () => {
    const service = setup(null);
    const error = (await failureOf(service.sendPrompt("session-1", "hello"))) as { code: string };
    expect(error.code).toBe("service_unavailable");
    const interruptError = (await failureOf(service.interrupt("session-1"))) as { code: string };
    expect(interruptError.code).toBe("service_unavailable");
  });

  it("maps session.interrupt results to a boolean", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const interrupted = service.interrupt("session-1");
    expect(socket.sent).toEqual([
      { opId: "op-1", action: "session.interrupt", params: { session_id: "session-1" } },
    ]);
    socket.respondOk(socket.lastOpId(), { session_id: "session-1", interrupted: true });
    await expect(interrupted).resolves.toBe(true);
    const notInterrupted = service.interrupt("session-1");
    socket.respondOk(socket.lastOpId(), { session_id: "session-1", interrupted: false });
    await expect(notInterrupted).resolves.toBe(false);
  });

  it("resolves session.mode applied mid-session", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.setMode("session-1", "acceptEdits");
    expect(socket.sent).toEqual([
      {
        opId: "op-1",
        action: "session.mode",
        params: { session_id: "session-1", mode: "acceptEdits" },
      },
    ]);
    socket.respondOk(socket.lastOpId(), {
      session_id: "session-1",
      mode: "acceptEdits",
      outcome: "mid_session_applied",
    });
    await expect(pending).resolves.toEqual({
      session_id: "session-1",
      mode: "acceptEdits",
      outcome: "mid_session_applied",
    });
  });

  it("raises mode_requires_restart as a DaemonError", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.setMode("session-1", "plan");
    socket.respondError(socket.lastOpId(), "mode_requires_restart", "turn active");
    const error = (await failureOf(pending)) as { code: string };
    expect(error.code).toBe("mode_requires_restart");
  });

  it("raises mode_rejected as a DaemonError", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.setMode("session-1", "bypassPermissions");
    socket.respondError(socket.lastOpId(), "mode_rejected", "unsupported mode");
    const error = (await failureOf(pending)) as { code: string };
    expect(error.code).toBe("mode_rejected");
  });

  it("maps approval.answer results", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.answerApproval("approval-1", "allow");
    expect(socket.sent).toEqual([
      {
        opId: "op-1",
        action: "approval.answer",
        params: { approval_id: "approval-1", decision: "allow" },
      },
    ]);
    socket.respondOk(socket.lastOpId(), { approval_id: "approval-1", status: "answered" });
    await expect(pending).resolves.toEqual({ approval_id: "approval-1", status: "answered" });
  });

  it("maps approval.cancel results", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.cancelApproval("approval-1");
    expect(socket.sent).toEqual([
      { opId: "op-1", action: "approval.cancel", params: { approval_id: "approval-1" } },
    ]);
    socket.respondOk(socket.lastOpId(), { approval_id: "approval-1", status: "cancelled" });
    await expect(pending).resolves.toEqual({ approval_id: "approval-1", status: "cancelled" });
  });

  it("maps expired approvals to a DaemonError", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const service = setup(socket);
    const pending = service.answerApproval("approval-1", "deny");
    socket.respondError(socket.lastOpId(), "approval_expired", "deadline passed");
    const error = (await failureOf(pending)) as { code: string };
    expect(error.code).toBe("approval_expired");
  });
});
