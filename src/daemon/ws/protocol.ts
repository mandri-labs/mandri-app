import type { CommandParams } from "../types/commands";
import { DaemonError } from "../errors";
import type { AgentParams } from "../types/agents";
import type {
  ApprovalAnswerParams,
  ApprovalCancelParams,
  EventMessage,
  GapMessage,
  RequestAction,
  RequestMessage,
  ResponseError,
  RuntimeStatus,
  ServerMessage,
  SessionInterruptParams,
  SessionModeParams,
  SessionPromptParams,
  SnapshotMessage,
  SnapshotSession,
  SubscribedMessage,
  UnsubscribedMessage,
} from "../types/ws";

export const OP_TIMEOUT_MS = 10_000;

export type RequestParamsOf<A extends RequestAction> = (CommandParams & AgentParams & {
  "conversation.read": { target: string; through_revision: number; completion_key: string };
  "session.list": Record<string, never>;
  "session.history": { session_id: string; cursor: string | null; limit: number };
  "approval.answer": ApprovalAnswerParams;
  "approval.cancel": ApprovalCancelParams;
  "session.mode": SessionModeParams;
  "session.prompt": SessionPromptParams;
  "session.interrupt": SessionInterruptParams;
})[A];

export interface Clock {
  now: () => number;
  setTimeout: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export type SeqRecordResult =
  { ok: true; duplicate: boolean } | { ok: false; gap: { from: number; to: number } };

export class TopicSeqTracker {
  private readonly lastByTopic = new Map<string, number>();

  record(topic: string, seq: number): SeqRecordResult {
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new RangeError(`invalid sequence number: ${seq}`);
    }
    const last = this.lastByTopic.get(topic);
    if (last === undefined) {
      this.lastByTopic.set(topic, seq);
      return { ok: true, duplicate: false };
    }
    if (seq <= last) {
      return { ok: true, duplicate: true };
    }
    this.lastByTopic.set(topic, seq);
    if (seq > last + 1) {
      return { ok: false, gap: { from: last + 1, to: seq - 1 } };
    }
    return { ok: true, duplicate: false };
  }

  reset(topic: string): void {
    this.lastByTopic.delete(topic);
  }

  resetAll(): void {
    this.lastByTopic.clear();
  }

  getSince(topic: string): number | undefined {
    const last = this.lastByTopic.get(topic);
    return last;
  }
}

interface PendingOp {
  deadline: number;
  timer: unknown;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: DaemonError) => void;
}

export class OpManager {
  private readonly clock: Clock;
  private readonly uuid: () => string;
  private readonly pending = new Map<string, PendingOp>();

  constructor(clock: Clock, uuid: () => string) {
    this.clock = clock;
    this.uuid = uuid;
  }

  createOp<A extends RequestAction>(
    action: A,
    params: RequestParamsOf<A>,
  ): { opId: string; message: Extract<RequestMessage, { action: A }> } {
    const opId = this.uuid();
    return {
      opId,
      message: { type: "request", op_id: opId, action, params } as Extract<
        RequestMessage,
        { action: A }
      >,
    };
  }

  registerOp(
    opId: string,
    resolve: (result: Record<string, unknown>) => void,
    reject: (error: DaemonError) => void,
    timeoutMs: number | null = null,
  ): void {
    if (this.pending.has(opId)) {
      throw new DaemonError({
        code: "duplicate_op_id",
        message: `op already in flight: ${opId}`,
      });
    }
    const deadline = timeoutMs === null ? Infinity : this.clock.now() + timeoutMs;
    const timer =
      timeoutMs === null
        ? null
        : this.clock.setTimeout(() => this.failTimedOut(opId, deadline), timeoutMs);
    this.pending.set(opId, { deadline, timer, resolve, reject });
  }

  handleResponse(
    opId: string,
    ok: boolean,
    result: Record<string, unknown> | null,
    error: ResponseError | null,
  ): boolean {
    const op = this.pending.get(opId);
    if (op === undefined) {
      return false;
    }
    this.clear(opId, op);
    if (ok) {
      op.resolve(result ?? {});
    } else {
      op.reject(new DaemonError({ code: error?.code ?? "unknown", message: error?.message ?? "" }));
    }
    return true;
  }

  expireOps(now: number): number {
    let fired = 0;
    for (const [opId, op] of [...this.pending.entries()]) {
      if (op.deadline <= now) {
        this.clear(opId, op);
        op.reject(this.timeoutError(opId));
        fired += 1;
      }
    }
    return fired;
  }

  failPending(cause: "connection_lost" | "daemon_changed"): void {
    for (const [opId, op] of [...this.pending]) {
      this.clear(opId, op);
      op.reject(
        new DaemonError({
          code: "delivery_unknown",
          message: "Connection ended before the operation was acknowledged",
          detail: { cause, op_id: opId },
        }),
      );
    }
  }

  private failTimedOut(opId: string, deadline: number): void {
    const op = this.pending.get(opId);
    if (op === undefined || op.deadline > deadline) {
      return;
    }
    this.clear(opId, op);
    op.reject(this.timeoutError(opId));
  }

  private clear(opId: string, op: PendingOp): void {
    if (op.timer !== null) this.clock.clearTimeout(op.timer);
    this.pending.delete(opId);
  }

  private timeoutError(opId: string): DaemonError {
    return new DaemonError({
      code: "unknown",
      message: `request timed out, state unknown: ${opId}`,
    });
  }
}

export interface SnapshotState {
  sessions: SnapshotSession[];
  runtimes: RuntimeStatus[];
}

export function applySnapshot(
  sessions: SnapshotSession[],
  runtimes: RuntimeStatus[],
): SnapshotState {
  return { sessions: [...sessions], runtimes: [...runtimes] };
}

export interface GapBookkeeping {
  type: GapMessage["reason"];
  topic: GapMessage["topic"];
}

export function gapToBookkeeping(frame: GapMessage): GapBookkeeping {
  return { type: frame.reason, topic: frame.topic };
}

const TYPED_TOPIC_FRAMES = new Set<string>([
  "conversation_status",
  "approval.pending",
  "approval.resolved",
  "session_stopped",
  "control_lost",
  "interaction_mode",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const frame = raw as Record<string, unknown>;
  const type = frame["type"];
  if (type === "ping") {
    return { type: "ping" };
  }
  if (type === "error") {
    const detail = frame["detail"];
    return typeof detail === "string" ? { type: "error", detail } : null;
  }
  if (type === "response") {
    const opId = frame["op_id"];
    const ok = frame["ok"];
    if (typeof opId !== "string" || typeof ok !== "boolean") {
      return null;
    }
    if (ok) {
      return {
        type: "response",
        op_id: opId,
        ok: true,
        result: asRecord(frame["result"]) ?? {},
        error: null,
      };
    }
    const errorFrame = asRecord(frame["error"]);
    const rawCode = errorFrame?.["code"];
    const rawMessage = errorFrame?.["message"];
    const error: ResponseError = {
      code: typeof rawCode === "string" ? rawCode : "unknown",
      message: typeof rawMessage === "string" ? rawMessage : "",
    };
    return { type: "response", op_id: opId, ok: false, result: null, error };
  }
  if (type === "snapshot") {
    const topic = frame["topic"];
    const sessions = frame["sessions"];
    const runtimes = frame["runtimes"];
    if (topic !== "sessions.all" || !Array.isArray(sessions) || !Array.isArray(runtimes)) {
      return null;
    }
    return raw as SnapshotMessage;
  }
  if (type === "gap") {
    const topic = frame["topic"];
    const fromSeq = frame["from_seq"];
    const seq = frame["seq"];
    const reason = frame["reason"];
    if (
      typeof topic !== "string" ||
      typeof fromSeq !== "number" ||
      typeof seq !== "number" ||
      (reason !== "retention_exceeded" && reason !== "history_lost" && reason !== "slow_consumer")
    ) {
      return null;
    }
    return raw as GapMessage;
  }
  if (typeof type === "string" && TYPED_TOPIC_FRAMES.has(type)) {
    const topic = frame["topic"];
    const seq = frame["seq"];
    if (typeof topic !== "string" || typeof seq !== "number") {
      return null;
    }
    return raw as ServerMessage;
  }
  const op = frame["op"];
  if (op === "subscribed") {
    const topic = frame["topic"];
    const fromSeq = frame["from_seq"];
    if (typeof topic !== "string" || typeof fromSeq !== "number") {
      return null;
    }
    return raw as SubscribedMessage;
  }
  if (op === "unsubscribed") {
    const topic = frame["topic"];
    if (typeof topic !== "string") {
      return null;
    }
    return raw as UnsubscribedMessage;
  }
  const topic = frame["topic"];
  const seq = frame["seq"];
  if (typeof topic === "string" && typeof seq === "number") {
    return raw as EventMessage;
  }
  return null;
}
