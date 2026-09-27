import { connectionStore } from "../../stores/connection";
import { DaemonError } from "../errors";
import { daemonToken } from "../auth";
import { createDebugLogger } from "@/lib/debug";
import type {
  ActionResultMap,
  ClientMessage,
  EventMessage,
  GapMessage,
  RequestAction,
  ServerMessage,
  SnapshotMessage,
  SubscribeMessage,
  WsTopic,
} from "../types/ws";
import {
  OpManager,
  RequestParamsOf,
  TopicSeqTracker,
  gapToBookkeeping,
  parseServerMessage,
} from "./protocol";
import type { Clock } from "./protocol";

const CORE_TOPICS: WsTopic[] = ["sessions.all", "runtimes", "gateway.events"];
const PING_TIMEOUT_MS = 45_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

type FrameHandler = (frame: ServerMessage) => void;

const log = createDebugLogger("ws.socket");

function createDefaultClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeout: (handle) => clearTimeout(handle as number),
  };
}

function reconnectDelayMs(attempt: number): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (attempt - 1));
  return Math.random() * ceiling;
}

export class MandriSocket {
  private readonly clock: Clock;
  private readonly ops: OpManager;
  private readonly tracker = new TopicSeqTracker();
  private readonly handlers = new Set<FrameHandler>();
  private readonly topics = new Set<WsTopic>(CORE_TOPICS);
  private readonly requestedSince = new Map<WsTopic, number | null>();
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private attempt = 0;
  private closedByCaller = false;
  private reconnectHandle: unknown = null;
  private pingWatchdog: unknown = null;
  private lastPingAt = 0;

  constructor(options?: { clock?: Clock }) {
    this.clock = options?.clock ?? createDefaultClock();
    this.ops = new OpManager(this.clock, () => crypto.randomUUID());
  }

  connect(url: string): void {
    if (this.url === url && this.ws !== null && this.ws.readyState < WebSocket.CLOSING) {
      return;
    }
    this.clearReconnectHandle();
    this.clearPingWatchdog();
    const previous = this.ws;
    this.ws = null;
    this.ops.failPending(
      this.url !== null && this.url !== url ? "daemon_changed" : "connection_lost",
    );
    previous?.close();
    if (this.url !== null && this.url !== url) {
      this.tracker.resetAll();
      this.requestedSince.clear();
    }
    this.url = url;
    this.closedByCaller = false;
    this.attempt = 0;
    const state = connectionStore.getState();
    state.setReconnectAttempt(0);
    state.setStatus("connecting");
    log.info("connect", { url, topics: [...this.topics] });
    this.openWebSocket();
  }

  close(): void {
    this.closedByCaller = true;
    this.clearPingWatchdog();
    this.clearReconnectHandle();
    this.ops.failPending("connection_lost");
    log.info("close requested by caller");
    this.ws?.close();
    this.ws = null;
    connectionStore.getState().setStatus("offline");
  }

  subscribe(topic: WsTopic, since?: number | null): void {
    if (this.topics.has(topic)) {
      return;
    }
    this.topics.add(topic);
    if (since !== undefined) this.requestedSince.set(topic, since);
    log.debug("subscribe requested", { topic, since: since ?? null, open: this.isOpen() });
    if (this.isOpen()) {
      this.sendSubscribe(topic, since);
    }
  }

  unsubscribe(topic: WsTopic): void {
    if (!this.topics.delete(topic)) {
      return;
    }
    this.tracker.reset(topic);
    this.requestedSince.delete(topic);
    log.debug("unsubscribe requested", { topic, open: this.isOpen() });
    if (this.isOpen()) {
      this.send({ op: "unsubscribe", topic });
    }
  }

  request<A extends RequestAction>(
    action: A,
    params: RequestParamsOf<A>,
  ): Promise<ActionResultMap[A]> {
    if (!this.isOpen()) {
      log.warn("request rejected, socket not open", { action });
      return Promise.reject(
        new DaemonError({ code: "service_unavailable", message: "socket not connected" }),
      );
    }
    const { opId, message } = this.ops.createOp(action, params);
    log.debug("request sent", { action, opId, params });
    return new Promise((resolve, reject) => {
      this.ops.registerOp(
        opId,
        (result) => {
          log.debug("request resolved", { action, opId, result });
          resolve(result as ActionResultMap[A]);
        },
        (error) => {
          log.warn("request failed", { action, opId, error });
          reject(error);
        },
      );
      try {
        this.send(message);
      } catch {
        this.ops.failPending("connection_lost");
        this.ws?.close();
      }
    });
  }

  onFrame(handler: FrameHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private openWebSocket(): void {
    if (this.url === null) {
      log.warn("openWebSocket skipped, no url");
      return;
    }
    log.debug("opening websocket", { url: this.url, attempt: this.attempt });
    const token = daemonToken(this.url);
    const socket = token ? new WebSocket(this.url, ["mandri", `mandri-token.${token}`]) : new WebSocket(this.url);
    this.ws = socket;
    socket.onopen = () => {
      if (this.ws === socket) this.handleOpen();
    };
    socket.onmessage = (event) => {
      if (this.ws === socket) this.handleMessage(event);
    };
    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      log.warn("websocket close event", {
        code: event.code,
        reason: event.reason || null,
        wasClean: event.wasClean,
      });
      this.handleClose();
    };
    socket.onerror = () => {
      log.error("websocket error event", { url: this.url, readyState: socket.readyState });
    };
  }

  private handleOpen(): void {
    this.attempt = 0;
    const state = connectionStore.getState();
    state.setReconnectAttempt(0);
    state.setStatus("online");
    this.lastPingAt = this.clock.now();
    this.armPingWatchdog();
    log.info("websocket open", { url: this.url, topics: [...this.topics] });
    for (const topic of this.topics) {
      this.sendSubscribe(topic);
    }
  }

  private handleMessage(event: MessageEvent): void {
    const data = event.data;
    if (typeof data !== "string") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      log.warn("unparseable frame dropped", { length: data.length });
      return;
    }
    const frame = parseServerMessage(parsed);
    if (frame === null) {
      log.warn("unrecognized frame dropped", { raw: parsed });
      return;
    }
    this.dispatch(frame);
  }

  private dispatch(frame: ServerMessage): void {
    if (!("type" in frame)) {
      if ("op" in frame && frame.op === "subscribed") {
        if (this.tracker.getSince(frame.topic) === undefined) {
          this.tracker.record(frame.topic, Math.max(0, frame.from_seq - 1));
        }
        this.requestedSince.delete(frame.topic);
        this.emit(frame);
        return;
      }
      if ("op" in frame && frame.op === "unsubscribed") {
        this.emit(frame);
        return;
      }
      this.handleEventFrame(frame);
      return;
    }
    switch (frame.type) {
      case "ping":
        this.send({ type: "pong" });
        this.lastPingAt = this.clock.now();
        this.armPingWatchdog();
        return;
      case "response":
        this.ops.handleResponse(frame.op_id, frame.ok, frame.result, frame.error);
        return;
      case "snapshot":
        this.handleSnapshot(frame);
        return;
      case "gap":
        this.handleGap(frame);
        return;
      default:
        if ("seq" in frame && "topic" in frame) {
          const recorded = this.tracker.record(frame.topic, frame.seq);
          if (recorded.ok && recorded.duplicate) return;
        }
        this.emit(frame);
    }
  }

  private handleSnapshot(frame: SnapshotMessage): void {
    this.tracker.reset(frame.topic);
    connectionStore.getState().clearSeqs();
    log.debug("snapshot received", { topic: frame.topic });
    this.emit(frame);
  }

  private handleGap(frame: GapMessage): void {
    const bookkeeping = gapToBookkeeping(frame);
    const state = connectionStore.getState();
    state.recordGap(bookkeeping.topic, bookkeeping.type);
    log.warn("gap received", { topic: bookkeeping.topic, type: bookkeeping.type });
    if (bookkeeping.type === "history_lost") {
      this.tracker.reset(frame.topic);
      this.tracker.record(frame.topic, Math.max(0, frame.seq - 1));
    }
    this.emit(frame);
  }

  private handleEventFrame(frame: EventMessage): void {
    const recorded = this.tracker.record(frame.topic, frame.seq);
    if (!recorded.ok) {
      connectionStore.getState().recordGap(frame.topic, "retention_exceeded");
      log.warn("event outside retention window", { topic: frame.topic, seq: frame.seq });
      this.emit(frame);
      return;
    }
    if (recorded.duplicate) {
      log.trace("duplicate event dropped", { topic: frame.topic, seq: frame.seq });
      return;
    }
    this.emit(frame);
  }

  private sendSubscribe(topic: WsTopic, since?: number | null): void {
    // Keep the caller's replay position across a connecting socket or a lost
    // subscription acknowledgement. Once frames arrive, the tracker takes over.
    const effectiveSince = since === undefined
      ? this.tracker.getSince(topic) ?? this.requestedSince.get(topic)
      : since;
    const message: SubscribeMessage =
      effectiveSince === undefined
        ? { op: "subscribe", topic }
        : { op: "subscribe", topic, since: effectiveSince };
    this.send(message);
  }

  private handleClose(): void {
    this.clearPingWatchdog();
    this.ops.failPending("connection_lost");
    this.ws = null;
    if (this.closedByCaller) {
      return;
    }
    this.attempt += 1;
    const state = connectionStore.getState();
    state.setStatus("reconnecting");
    state.setReconnectAttempt(this.attempt);
    log.warn("scheduling reconnect", { attempt: this.attempt });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectHandle();
    const delay = reconnectDelayMs(this.attempt);
    log.debug("reconnect delay computed", { attempt: this.attempt, delayMs: Math.round(delay) });
    this.reconnectHandle = this.clock.setTimeout(() => {
      this.reconnectHandle = null;
      this.openWebSocket();
    }, delay);
  }

  private armPingWatchdog(): void {
    this.clearPingWatchdog();
    this.pingWatchdog = this.clock.setTimeout(() => {
      if (this.clock.now() - this.lastPingAt >= PING_TIMEOUT_MS) {
        const expired = this.ws;
        this.handleClose();
        expired?.close();
      }
    }, PING_TIMEOUT_MS);
  }

  private clearPingWatchdog(): void {
    if (this.pingWatchdog !== null) {
      this.clock.clearTimeout(this.pingWatchdog);
      this.pingWatchdog = null;
    }
  }

  private clearReconnectHandle(): void {
    if (this.reconnectHandle !== null) {
      this.clock.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private send(message: ClientMessage): void {
    if (this.isOpen()) {
      log.trace("frame sent", message);
      this.ws?.send(JSON.stringify(message));
    }
  }

  private emit(frame: ServerMessage): void {
    for (const handler of [...this.handlers]) {
      handler(frame);
    }
  }
}
