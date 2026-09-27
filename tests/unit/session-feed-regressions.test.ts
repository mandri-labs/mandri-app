import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DaemonError } from "@/daemon/errors";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import type { HistoryPage } from "@/daemon/ws/sessionFeed";
import { connectionStore } from "@/stores/connection";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import type { EventMessage } from "@/daemon/types/ws";

const raw = (id: string, text = id) => ({
  type: "user",
  uuid: id,
  message: { role: "user", content: [{ type: "text", text }] },
});
const event = (seq: number, id: string, text = id): EventMessage => ({
  topic: "session.s1",
  seq,
  ts: seq,
  source: "claude",
  raw: raw(id, text),
});
const page = (...ids: string[]): HistoryPage => ({
  entries: ids.map((id) => JSON.stringify(raw(id))),
  next_cursor: null,
  has_more: false,
});
beforeEach(() => {
  transcriptStore.getState().resetTranscripts();
  sessionsStore.setState({ sessions: {}, order: [] });
  connectionStore.getState().setStatus("online");
});

it.each(["mount first", "subscription first"])(
  "keeps a new Codex session on the live feed with %s",
  async (order) => {
    const fetch = vi.fn(async () => page());
    const subscribe = vi.fn();
    const socket = { subscribe, request: vi.fn() };
    const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => socket });
    service.ensureSession("s1", "codex", { newSession: true });
    expect(service.getFlags("s1").historyExhausted).toBe(true);
    service.subscribeSession("s1");
    expect(subscribe).toHaveBeenCalledWith("session.s1", 0);
    const subscribed = { op: "subscribed", topic: "session.s1", from_seq: 1 } as const;
    if (order === "mount first") await service.loadHistory("s1");
    service.ingestSessionFrame("s1", "codex", subscribed);
    if (order === "subscription first") await service.loadHistory("s1");
    service.ingestSessionFrame("s1", "codex", { ...subscribed, from_seq: 2 });
    service.ensureSession("s1", "codex");
    await service.loadHistory("s1", { refresh: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(service.getFlags("s1").historyUnavailable).toBe(false);
    expect(service.getNodes("s1")).toEqual([]);

    service.ingestSessionFrame("s1", "codex", {
      ...event(1, "answer"),
      source: "codex",
      raw: {
        method: "item/completed",
        params: { threadId: "native", item: { id: "answer", type: "agentMessage", text: "OK" } },
      },
    });
    expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "OK" }));
    expect(fetch).not.toHaveBeenCalled();
    service.ingestSessionFrame("s1", "codex", {
      ...event(2, "done"),
      source: "codex",
      raw: { method: "turn/completed", params: { turn: { id: "turn", status: "completed" } } },
    });
    await service.loadHistory("s1");
    expect(fetch).not.toHaveBeenCalled();
    expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "OK" }));
    expect(service.getFlags("s1").historyUnavailable).toBe(false);
  },
);

it.each([
  ["claude", { type: "result", session_id: "native" }],
  ["opencode", { type: "session.idle", properties: { sessionID: "native" } }],
] as const)("%s keeps using the live feed after terminal events", async (harness, raw) => {
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness,
        nativeId: "native",
        state: "live",
        title: "New",
        deleted: false,
        pendingApprovals: 0,
      },
    },
  });
  const fetch = vi.fn(async () => page());
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", harness, { newSession: true });
  await service.loadHistory("s1");
  expect(fetch).not.toHaveBeenCalled();
  service.ingestSessionFrame("s1", harness, { ...event(1, "done"), source: harness, raw });
  service.ingestSessionFrame("s1", harness, { ...event(2, "done-again"), source: harness, raw });
  await service.loadHistory("s1");
  expect(fetch).not.toHaveBeenCalled();
  expect(service.getFlags("s1").historyExhausted).toBe(true);
});

it.each(["session metadata", "thread event", "turn event"])(
  "does not fetch history on child or parent Codex completion with %s",
  async (identitySource) => {
    sessionsStore.setState({
      sessions: {
        s1: {
          id: "s1",
          harness: "codex",
          nativeId: identitySource === "session metadata" ? "parent" : null,
          state: "live",
          title: "New",
          deleted: false,
          pendingApprovals: 0,
        },
      },
    });
    const fetch = vi.fn(async () => page());
    const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
    service.ensureSession("s1", "codex", { newSession: true });
    service.ingestSessionFrame("s1", "codex", {
      ...event(1, "started"),
      source: "codex",
      raw:
        identitySource === "thread event"
          ? { method: "thread/started", params: { thread: { id: "parent" } } }
          : { method: "turn/started", params: { threadId: "parent" } },
    });
    service.ingestSessionFrame("s1", "codex", {
      ...event(2, "child"),
      source: "codex",
      raw: { method: "turn/completed", params: { threadId: "child", turn: { id: "child-turn" } } },
    });
    await service.loadHistory("s1");
    expect(fetch).not.toHaveBeenCalled();
    service.ingestSessionFrame("s1", "codex", {
      ...event(3, "parent"),
      source: "codex",
      raw: {
        method: "turn/completed",
        params: { threadId: "parent", turn: { id: "parent-turn" } },
      },
    });
    await service.loadHistory("s1");
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("loads history when reopening a previously new session", async () => {
  const fetch = vi.fn(async () => page("stored"));
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude", { newSession: true });
  await service.loadHistory("s1");
  expect(fetch).not.toHaveBeenCalled();
  service.closeSession("s1");
  service.ensureSession("s1", "claude");
  expect(service.getFlags("s1").historyExhausted).toBe(false);
  await service.loadHistory("s1");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "stored" }));
});

it("reconciles an explicit history change in a newly created session", async () => {
  const fetch = vi.fn(async () => page("stored"));
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude", { newSession: true });
  service.ingestSessionFrame("s1", "claude", {
    ...event(1, "changed"), source: "mandri", raw: { type: "history_changed" },
  });
  await service.loadHistory("s1");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "stored" }));
});

it("reconciles a new session on a real connection recovery before its first terminal event", async () => {
  const fetch = vi.fn(async () => page());
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "codex", { newSession: true });
  const subscribed = { op: "subscribed", topic: "session.s1", from_seq: 1 } as const;
  service.ingestSessionFrame("s1", "codex", subscribed);
  connectionStore.getState().setStatus("reconnecting");
  await service.loadHistory("s1");
  expect(fetch).not.toHaveBeenCalled();
  connectionStore.getState().setStatus("online");
  expect(fetch).not.toHaveBeenCalled();
  service.ingestSessionFrame("s1", "codex", subscribed);
  await service.loadHistory("s1");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["history_lost", "retention_exceeded", "slow_consumer"] as const)(
  "does not defer new-session reconciliation after a %s gap",
  async (reason) => {
    const fetch = vi.fn(async () => page("stored"));
    const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
    service.ensureSession("s1", "claude", { newSession: true });
    service.ingestSessionFrame("s1", "claude", {
      type: "gap",
      topic: "session.s1",
      reason,
      from_seq: 1,
      seq: 10,
    });
    service.ingestSessionFrame("s1", "claude", event(10, "live"));
    await service.loadHistory("s1");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "stored" }));
    expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "live" }));
  },
);

it("ends new-session deferral when leaving its subscription", async () => {
  const fetch = vi.fn(async () => page());
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "codex", { newSession: true });
  service.unsubscribeSession("s1");
  service.ingestSessionFrame("s1", "codex", {
    op: "subscribed",
    topic: "session.s1",
    from_seq: 1,
  });
  await service.loadHistory("s1");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("still reports a genuine unavailable historical transcript", async () => {
  const fetch = vi.fn(async () => {
    throw new DaemonError({ code: "harness_store_unavailable", message: "Missing rollout" });
  });
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "codex");
  await service.loadHistory("s1");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.getFlags("s1").historyUnavailable).toBe(true);
  expect(service.getNodes("s1")).toContainEqual(
    expect.objectContaining({ kind: "system", messageKey: "core.transcript.history_unavailable" }),
  );
});

it("reconciles an uncertain delivery only after the user message appears in history", async () => {
  const fetchHistoryPage = vi.fn(async () => page());
  const service = new SessionFeedService({ fetchHistoryPage, getSocket: () => null });
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness: "claude",
        state: "live",
        title: "Session",
        deleted: false,
        pendingApprovals: 0,
        promptError: "error.delivery_unknown",
        sending: false,
        awaitingResponse: false,
      },
    },
  });
  service.ensureSession("s1", "claude");
  transcriptStore.getState().addPendingUser("s1", "Only once");
  await service.loadHistory("s1", { refresh: true });
  expect(sessionsStore.getState().sessions.s1?.promptError).toBe("error.delivery_unknown");
  fetchHistoryPage.mockResolvedValue({
    ...page(),
    entries: [JSON.stringify(raw("accepted", "Only once"))],
  });
  await service.loadHistory("s1", { refresh: true });
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(0);
  expect(sessionsStore.getState().sessions.s1?.promptError).toBeNull();
  expect(service.getNodes("s1")).toHaveLength(1);
});

it("merges history with live messages in both arrival orders without merging distinct messages", async () => {
  const service = new SessionFeedService({
    fetchHistoryPage: async () => page("one"),
    getSocket: () => null,
  });
  service.ingestSessionFrame("s1", "claude", event(1, "one"));
  await service.loadHistory("s1");
  expect(service.getNodes("s1")).toHaveLength(1);
  service.ingestSessionFrame("s1", "claude", event(2, "one"));
  expect(service.getNodes("s1")).toHaveLength(1);
  service.ingestSessionFrame("s1", "claude", event(3, "two", "one"));
  expect(service.getNodes("s1")).toHaveLength(2);
});

it.each([false, true])("restores Claude string prompts without duplicate live echoes (history first: %s)", async (historyFirst) => {
  const stored = { ...raw("prompt", "Hello"), message: { role: "user", content: "Hello" } };
  const service = new SessionFeedService({
    fetchHistoryPage: async () => ({ ...page(), entries: [JSON.stringify(stored)] }),
    getSocket: () => null,
  });
  service.ensureSession("s1", "claude");
  if (historyFirst) await service.loadHistory("s1");
  service.ingestSessionFrame("s1", "claude", event(1, "prompt", "Hello"));
  await service.loadHistory("s1", { refresh: true });
  expect(service.getNodes("s1")).toMatchObject([{ kind: "user", text: "Hello", key: "prompt:user:0" }]);
  service.closeSession("s1");
  service.ensureSession("s1", "claude");
  await service.loadHistory("s1");
  expect(service.getNodes("s1")).toMatchObject([{ kind: "user", text: "Hello", key: "prompt:user:0" }]);
});

it("ignores legacy usage collection warnings without hiding transcript errors", () => {
  const service = new SessionFeedService({ getSocket: () => null });
  for (const seq of [1, 2]) {
    service.ingestSessionFrame("s1", "claude", {
      ...event(seq, "usage"), source: "mandri", raw: { error: "usage_collection_failed" },
    });
  }
  service.ingestSessionFrame("s1", "claude", event(3, "prompt", "Hello"));
  expect(service.getNodes("s1")).toMatchObject([
    { kind: "user", text: "Hello" },
  ]);
  expect(service.getFlags("s1").gapFlag).toBe(false);
  service.ingestSessionFrame("s1", "claude", {
    ...event(4, "corrupt"), source: "mandri", raw: { error: "parse_error", size: 100 },
  });
  expect(service.getNodes("s1").at(-1)).toMatchObject({ messageKey: "core.transcript.feed_degraded" });
});

it("does not let a closed buffer overwrite its replacement", async () => {
  let resolve!: (page: HistoryPage) => void;
  const service = new SessionFeedService({
    fetchHistoryPage: () =>
      new Promise((done) => {
        resolve = done;
      }),
    getSocket: () => null,
  });
  service.ensureSession("s1", "claude");
  const loading = service.loadHistory("s1");
  service.closeSession("s1");
  service.ingestSessionFrame("s1", "claude", event(1, "new"));
  resolve(page("old"));
  await loading;
  expect(service.getNodes("s1")).toEqual([expect.objectContaining({ text: "new" })]);
});

it("resets the feed sequence after history loss and retains the event following a gap", async () => {
  const service = new SessionFeedService({
    fetchHistoryPage: async () => page(),
    getSocket: () => null,
  });
  service.ingestSessionFrame("s1", "claude", event(20, "old"));
  service.ingestSessionFrame("s1", "claude", {
    type: "gap",
    topic: "session.s1",
    reason: "history_lost",
    from_seq: 21,
    seq: 1,
  });
  service.ingestSessionFrame("s1", "claude", event(1, "new"));
  service.ingestSessionFrame("s1", "claude", event(3, "after-gap"));
  await Promise.resolve();
  expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "new" }));
  expect(service.getNodes("s1")).toContainEqual(expect.objectContaining({ text: "after-gap" }));
});

it("queues a gap refresh behind an in-flight history request", async () => {
  let resolve!: (page: HistoryPage) => void;
  const fetch = vi
    .fn<() => Promise<HistoryPage>>()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(page("fresh"));
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  const loading = service.loadHistory("s1");
  service.handleGap("s1");
  resolve(page("old"));
  await loading;
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(service.getNodes("s1")).toEqual([expect.objectContaining({ text: "fresh" })]);
});

it("reduces tool results across history pages", async () => {
  const use = {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash" }] },
  };
  const result = {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
  };
  const fetch = vi
    .fn<() => Promise<HistoryPage>>()
    .mockResolvedValueOnce({
      entries: [JSON.stringify(result)],
      next_cursor: "older",
      has_more: true,
    })
    .mockResolvedValueOnce({ entries: [JSON.stringify(use)], next_cursor: null, has_more: false });
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  await service.loadHistory("s1");
  await service.loadHistory("s1");
  expect(service.getNodes("s1")).toEqual([
    expect.objectContaining({ kind: "tool", tool: "Bash", status: "done" }),
  ]);
});

it("makes concurrent history callers wait for the same in-flight page", async () => {
  let resolve!: (page: HistoryPage) => void;
  const fetch = vi.fn(
    () =>
      new Promise<HistoryPage>((done) => {
        resolve = done;
      }),
  );
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  const initial = service.loadHistory("s1");
  const duplicate = service.loadHistory("s1");
  expect(duplicate).toBe(initial);
  let settled = false;
  void duplicate.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  resolve(page("loaded"));
  await duplicate;
  expect(service.getNodes("s1")).toEqual([expect.objectContaining({ text: "loaded" })]);
});

it("does not repeatedly fetch an exhausted empty history", async () => {
  const fetch = vi.fn(async () => page());
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  await service.loadHistory("s1");
  await service.loadHistory("s1");
  expect(fetch).toHaveBeenCalledTimes(1);
  await service.loadHistory("s1", { refresh: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("retains older pages and their cursor when a session subscription reconnects", async () => {
  const fetch = vi
    .fn<() => Promise<HistoryPage>>()
    .mockResolvedValueOnce({ ...page("recent"), next_cursor: "older", has_more: true })
    .mockResolvedValueOnce({ ...page("old"), next_cursor: "oldest", has_more: true })
    .mockResolvedValueOnce({ ...page("recent", "new"), next_cursor: "older", has_more: true })
    .mockResolvedValue(page("oldest"));
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  await service.loadHistory("s1");
  await service.loadHistory("s1");
  service.ingestSessionFrame("s1", "claude", {
    op: "subscribed",
    topic: "session.s1",
    from_seq: 1,
  });
  await service.loadHistory("s1");
  expect(service.getNodes("s1").map((node) => ("text" in node ? node.text : null))).toEqual([
    "old",
    "recent",
    "new",
  ]);
  await service.loadHistory("s1");
  expect(fetch).toHaveBeenLastCalledWith("s1", "oldest", 500);
});

for (const harness of ["claude", "codex", "opencode"] as const) {
  it(`${harness} restores completed and active turns after a full store reset`, async () => {
    sessionsStore.setState({
      sessions: {
        s1: {
          id: "s1",
          harness,
          state: "live",
          title: "Reloaded",
          deleted: false,
          pendingApprovals: 0,
          activity: "active",
        },
      },
      order: ["s1"],
    });
    let active = false;
    const service = new SessionFeedService({
      fetchHistoryPage: async () => ({ ...page(), turn_active: active }),
      getSocket: () => null,
    });
    service.ensureSession("s1", harness);
    await service.loadHistory("s1");
    expect(sessionsStore.getState().sessions.s1?.nativeTurnActive).toBe(false);
    active = true;
    await service.loadHistory("s1", { refresh: true });
    expect(sessionsStore.getState().sessions.s1?.nativeTurnActive).toBe(true);
    active = false;
    await service.loadHistory("s1", { refresh: true });
    expect(sessionsStore.getState().sessions.s1?.nativeTurnActive).toBe(false);
  });
}

it.each(["live completion", "new prompt"])(
  "history cannot overwrite %s received while loading",
  async (scenario) => {
    sessionsStore.setState({
      sessions: {
        s1: {
          id: "s1",
          harness: "claude",
          state: "live",
          title: "Reloaded",
          deleted: false,
          pendingApprovals: 0,
          activity: "active",
        },
      },
    });
    let resolve!: (value: HistoryPage) => void;
    const service = new SessionFeedService({
      fetchHistoryPage: () =>
        new Promise((done) => {
          resolve = done;
        }),
      getSocket: () => null,
    });
    service.ensureSession("s1", "claude");
    const loading = service.loadHistory("s1");
    if (scenario === "live completion") {
      sessionsStore.getState().ingestFrame({ ...event(1, "end"), raw: { type: "result" } });
    } else {
      sessionsStore.getState().applySessionPatch("s1", { sending: true, awaitingResponse: true });
      sessionsStore.getState().applySessionPatch("s1", { sending: false });
    }
    resolve({ ...page(), turn_active: scenario === "live completion" });
    await loading;
    expect(sessionsStore.getState().sessions.s1?.nativeTurnActive).toBe(
      scenario === "live completion" ? false : undefined,
    );
  },
);


it("keeps Codex steering after the initial prompt through history refresh and event replay", async () => {
  let entries: string[] = [];
  const service = new SessionFeedService({ fetchHistoryPage: async () => ({ entries, next_cursor: null, has_more: false }) });
  service.ensureSession("s1", "codex");
  await service.loadHistory("s1");
  const user = (id: string, text: string) => ({ method: "item/completed", params: {
    turnId: "turn", item: { type: "userMessage", id, content: [{ type: "text", text }] },
  } });
  const ingest = (seq: number, raw: unknown) => service.ingestSessionFrame("s1", "codex", {
    topic: "session.s1", seq, ts: seq, source: "codex", raw,
  });
  const texts = () => service.getNodes("s1").flatMap((node) => "text" in node ? [node.text] : []);
  ingest(1, user("initial", "Implement the feature"));
  ingest(2, { method: "item/completed", params: {
    turnId: "turn", item: { type: "agentMessage", id: "answer", text: "Working" },
  } });
  transcriptStore.getState().addPendingUser("s1", "Include the second provider");
  ingest(3, user("steering", "Include the second provider"));
  const expected = ["Implement the feature", "Working", "Include the second provider"];
  expect(texts()).toEqual(expected);
  expect(transcriptStore.getState().transcripts.s1!.pendingUsers).toHaveLength(0);
  entries = expected.map((text, index) => JSON.stringify({
    timestamp: `2026-01-01T00:00:0${index}Z`, type: "response_item", payload: {
      type: "message", role: index === 1 ? "assistant" : "user", id: index === 1 ? "answer" : undefined,
      content: [{ type: index === 1 ? "output_text" : "input_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn", content_item_kinds: ["user.text"] },
    },
  }));
  await service.loadHistory("s1", { refresh: true });
  expect(texts()).toEqual(expected);
  ingest(4, user("steering", "Include the second provider"));
  expect(texts()).toEqual(expected);
  await service.loadHistory("s1", { refresh: true });
  expect(texts()).toEqual(expected);
  expect(transcriptStore.getState().transcripts.s1!.localUsers).toHaveLength(0);
});


it("acknowledges persisted steering sent before the first assistant response", async () => {
  let entries: string[] = [];
  const service = new SessionFeedService({ fetchHistoryPage: async () => ({ entries, next_cursor: null, has_more: false }) });
  service.ensureSession("s1", "codex");
  await service.loadHistory("s1");
  const ingest = (seq: number, text: string) => service.ingestSessionFrame("s1", "codex", {
    topic: "session.s1", seq, ts: seq, source: "codex", raw: { method: "item/completed", params: {
      turnId: "turn", item: { type: "userMessage", id: `user-${seq}`, content: [{ type: "text", text }] },
    } },
  });
  ingest(1, "Initial prompt");
  transcriptStore.getState().addPendingUser("s1", "Steering");
  ingest(2, "Steering");
  entries = ["Initial prompt", "Steering"].map((text, index) => JSON.stringify({
    timestamp: `2026-01-01T00:00:0${index}Z`, type: "response_item", payload: {
      type: "message", role: "user", content: [{ type: "input_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn", content_item_kinds: ["user.text"] },
    },
  }));
  await service.loadHistory("s1", { refresh: true });
  expect(transcriptStore.getState().transcripts.s1!.localUsers).toHaveLength(0);
  expect(service.getNodes("s1").map((node) => "text" in node ? node.text : undefined)).toEqual(["Initial prompt", "Steering"]);
});

it("restores OpenCode part identity from history before the next live delta", async () => {
  const entries = [
    { type: "message.updated", properties: { info: { id: "assistant", role: "assistant" } } },
    { type: "message.part.updated", properties: { part: { id: "reasoning", messageID: "assistant", type: "reasoning", text: "Before" } } },
    { type: "message.updated", properties: { info: { id: "user", role: "user" } } },
    { type: "message.part.updated", properties: { part: { id: "prompt", messageID: "user", type: "text", text: "Prompt" } } },
  ].map((raw) => JSON.stringify(raw));
  const service = new SessionFeedService({
    fetchHistoryPage: async () => ({ entries, next_cursor: null, has_more: false }),
    getSocket: () => null,
  });
  service.ensureSession("s1", "opencode");
  await service.loadHistory("s1");
  service.ingestSessionFrame("s1", "opencode", { ...event(1, "delta"), source: "opencode", raw: {
    type: "message.part.delta", properties: { partID: "reasoning", field: "text", delta: " after" },
  } });
  service.ingestSessionFrame("s1", "opencode", { ...event(2, "prompt"), source: "opencode", raw: {
    type: "message.part.updated", properties: { part: { id: "prompt", messageID: "user", type: "text", text: "Prompt" } },
  } });
  expect(service.getNodes("s1")).toMatchObject([
    { kind: "thinking", text: "Before after", key: "reasoning" },
    { kind: "user", text: "Prompt", key: "prompt" },
  ]);
});

it("does not let an old history response overwrite fresh external activity", async () => {
  sessionsStore.setState({ sessions: { s1: { id: "s1", harness: "opencode", state: "discovered", title: "External", deleted: false, pendingApprovals: 0, externalBusy: false } } });
  let resolve!: (page: HistoryPage) => void;
  const service = new SessionFeedService({ fetchHistoryPage: () => new Promise((done) => { resolve = done; }), getSocket: () => null });
  service.ensureSession("s1", "opencode");
  const loading = service.loadHistory("s1");
  sessionsStore.getState().applySessionPatch("s1", { externalBusy: true, externalModel: "current" });
  resolve({ ...page(), external_busy: false, external_model: "previous" });
  await loading;
  expect(sessionsStore.getState().sessions.s1).toMatchObject({ externalBusy: true, externalModel: "current" });
});

afterEach(() => vi.useRealTimers());

it.each(["delivery_unknown", "service_unavailable"] as const)("retries %s history failures while still online without a transcript error", async (code) => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new DaemonError({ code, message: "socket disconnected" })).mockResolvedValueOnce(page("recovered"));
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  const loading = service.loadHistory("s1");
  await vi.advanceTimersByTimeAsync(499);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.getFlags("s1").historyUnavailable).toBe(false);
  expect(service.getNodes("s1")).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await loading;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(service.getNodes("s1")).toMatchObject([{ kind: "user", text: "recovered" }]);
});

it("retries the same older history page before a queued reconnect refresh", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ...page("recent"), next_cursor: "older", has_more: true })
    .mockRejectedValueOnce(new DaemonError({ code: "delivery_unknown", message: "lost history response" }))
    .mockResolvedValueOnce(page("old"))
    .mockResolvedValueOnce(page("recent", "new"));
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  await service.loadHistory("s1");
  const older = service.loadHistory("s1");
  connectionStore.getState().setStatus("reconnecting");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  connectionStore.getState().setStatus("online");
  service.ingestSessionFrame("s1", "claude", { op: "subscribed", topic: "session.s1", from_seq: 1 });
  await older;
  expect(fetch.mock.calls.map((args) => args[1])).toEqual([null, "older", "older", null]);
  expect(service.getNodes("s1").map((node) => "text" in node ? node.text : null)).toEqual(["old", "recent", "new"]);
});

it("backs off consecutive online history failures and cancels retry when the buffer closes", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new DaemonError({ code: "service_unavailable", message: "try again" }));
  const service = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  service.ensureSession("s1", "claude");
  const loading = service.loadHistory("s1");
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(3);
  service.closeSession("s1");
  await loading;
  await vi.advanceTimersByTimeAsync(20_000);
  connectionStore.getState().setStatus("reconnecting");
  connectionStore.getState().setStatus("online");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
  expect(service.hasSession("s1")).toBe(false);
});
