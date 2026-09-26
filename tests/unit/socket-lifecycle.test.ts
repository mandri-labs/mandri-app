import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MandriSocket } from "@/daemon/ws/socket";
import type { ServerMessage } from "@/daemon/types/ws";

class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: object) => void;
  constructor() {
    Socket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  receive(frame: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

const event = (seq: number): ServerMessage => ({
  topic: "session.s1",
  seq,
  source: "claude",
  ts: seq,
  raw: { type: "user", content: `message ${seq}` },
});
let client: MandriSocket;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  Socket.instances = [];
  client = new MandriSocket();
  client.connect("ws://daemon/v1/ws");
});

afterEach(() => {
  client.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("delivers the announced first event and resumes after the last received event", () => {
  const frames: ServerMessage[] = [];
  client.onFrame((frame) => frames.push(frame));
  const socket = Socket.instances[0]!;
  socket.open();
  client.subscribe("session.s1");
  socket.receive({ op: "subscribed", topic: "session.s1", from_seq: 1 });
  socket.receive(event(1));
  socket.receive(event(1));
  expect(frames.filter((frame) => "raw" in frame)).toEqual([event(1)]);
  socket.close();
  vi.advanceTimersByTime(250);
  const reconnected = Socket.instances[1]!;
  reconnected.open();
  expect(reconnected.sent).toContainEqual({ op: "subscribe", topic: "session.s1", since: 1 });
  reconnected.receive({ op: "subscribed", topic: "session.s1", from_seq: 2 });
  reconnected.receive(event(2));
  expect(frames.filter((frame) => "raw" in frame)).toEqual([event(1), event(2)]);
});

it("recovers a fresh sequence epoch without subscribing twice", () => {
  const received = vi.fn();
  client.onFrame(received);
  const socket = Socket.instances[0]!;
  socket.open();
  client.subscribe("session.s1");
  client.subscribe("session.s1");
  socket.receive(event(20));
  socket.receive({
    type: "gap",
    topic: "session.s1",
    reason: "history_lost",
    from_seq: 21,
    seq: 1,
  });
  socket.receive(event(1));
  expect(received).toHaveBeenLastCalledWith(event(1));
  expect(socket.sent.filter((frame) => frame.topic === "session.s1")).toHaveLength(1);
  client.unsubscribe("session.s1");
  client.unsubscribe("session.s1");
  expect(socket.sent.filter((frame) => frame.op === "unsubscribe")).toHaveLength(1);
});

it("ignores callbacks from a replaced socket", () => {
  const old = Socket.instances[0]!;
  client.connect("ws://daemon/v1/ws");
  expect(Socket.instances).toHaveLength(1);
  client.connect("ws://other/v1/ws");
  const current = Socket.instances[1]!;
  current.open();
  old.onclose?.({ code: 1006 });
  client.subscribe("session.s1");
  expect(current.sent).toContainEqual({ op: "subscribe", topic: "session.s1" });
  vi.advanceTimersByTime(1000);
  expect(Socket.instances).toHaveLength(2);
});

it.each(["remote close", "caller close", "daemon change", "watchdog", "send failure"])(
  "settles unacknowledged operations on %s without resending",
  async (reason) => {
    const socket = Socket.instances[0]!;
    socket.open();
    if (reason === "send failure")
      vi.spyOn(socket, "send").mockImplementation(() => {
        throw new Error("closed");
      });
    const result = client
      .request("session.prompt", { session_id: "s1", content: "Only once" })
      .catch((error: unknown) => error);
    if (reason === "remote close") socket.close();
    if (reason === "caller close") client.close();
    if (reason === "daemon change") client.connect("ws://other/v1/ws");
    if (reason === "watchdog") vi.advanceTimersByTime(45_000);
    expect(await result).toMatchObject({ code: "delivery_unknown" });
    vi.advanceTimersByTime(500);
    const reconnected = Socket.instances[1];
    reconnected?.open();
    expect(reconnected?.sent.some((frame) => frame.type === "request") ?? false).toBe(false);
  },
);

it("keeps a healthy operation pending beyond ten seconds", async () => {
  const socket = Socket.instances[0]!;
  socket.open();
  const settled = vi.fn();
  const result = client.request("session.prompt", { session_id: "s1", content: "Wait" });
  void result.then(settled);
  vi.advanceTimersByTime(30_000);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  const request = socket.sent.find((frame) => frame.action === "session.prompt")!;
  socket.receive({
    type: "response",
    op_id: String(request.op_id),
    ok: true,
    result: { state: "queued", code: null },
    error: null,
  });
  await expect(result).resolves.toEqual({ state: "queued", code: null });
});
