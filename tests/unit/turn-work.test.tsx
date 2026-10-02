import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EventMessage, HarnessKind } from "@/daemon/types/ws";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { turnCompleted } from "@/features/transcript/turns/types";
import { WorkingIndicator } from "@/features/transcript/WorkingIndicator";
import { Transcript } from "@/features/transcript/Transcript";
import { initI18n } from "@/i18n";
import { turnFixture } from "./turn-work-fixtures";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; getItemKey: (index: number) => string }) => ({
    getTotalSize: () => options.count * 40,
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, key: options.getItemKey(index), start: index * 40 })),
    measureElement: () => {}, scrollToEnd: () => {}, scrollRect: { height: 800 },
  }),
}));

const harnesses: HarnessKind[] = ["codex", "claude", "opencode", "agy", "pi"];
const turns = () => sessionsStore.getState().sessions.s!.turnWork ?? [];
beforeAll(() => initI18n("en"));

it("keeps a failed Codex turn beside its error when a later turn succeeds", async () => {
  const { feed, send, setHistory } = setup("codex");
  send({ method: "turn/started", params: { threadId: "native", turn: { id: "failed" } } }, 1000);
  send({ method: "error", params: { threadId: "native", turnId: "failed", willRetry: false,
    error: { message: "Synthetic provider rejection" } } }, 2000);
  send({ method: "turn/completed", params: { threadId: "native",
    turn: { id: "failed", status: "failed", error: { message: "Synthetic provider rejection" } } } }, 2000);
  const success = turnFixture("codex", "success", 10000);
  send(success.starts, success.start);
  for (const body of success.bodies) send(body, success.start + 500);
  for (const finish of success.finishes) send(finish, success.end);
  const view = render(<Transcript sessionId="s" harness="codex" feed={feed} />);
  await act(async () => {});
  const text = view.container.textContent!;
  expect(text.indexOf("Failed after 1s")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("Failed after 1s")).toBeLessThan(text.indexOf("Synthetic provider rejection"));
  expect(text.indexOf("Failed after 1s")).toBeLessThan(text.indexOf("Same answer"));
  const history = [
    JSON.stringify({ timestamp: new Date(1000).toISOString(), type: "event_msg",
      payload: { type: "task_started", turn_id: "failed" } }),
    JSON.stringify({ timestamp: new Date(2000).toISOString(), type: "event_msg",
      payload: { type: "task_complete", turn_id: "failed", error: { message: "Synthetic provider rejection" } } }),
    ...success.history,
  ];
  setHistory(history);
  await act(async () => { await feed.loadHistory("s", { refresh: true, preserveOlder: true }); });
  expect(view.container.textContent!.indexOf("Failed after 1s"))
    .toBeLessThan(view.container.textContent!.indexOf("Same answer"));
  expect(view.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(2);
  view.unmount();
  feed.closeSession("s");
  sessionsStore.setState(sessionsStore.getInitialState());
  const cold = setup("codex", history);
  await cold.feed.loadHistory("s");
  const reloaded = render(<Transcript sessionId="s" harness="codex" feed={cold.feed} />);
  await act(async () => {});
  expect(reloaded.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(2);
  expect(reloaded.container.textContent!.indexOf("Failed after 1s"))
    .toBeLessThan(reloaded.container.textContent!.indexOf("Synthetic provider rejection"));
});
beforeEach(() => {
  sessionsStore.setState(sessionsStore.getInitialState());
  transcriptStore.getState().resetTranscripts();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(harness: HarnessKind, history: string[] = []) {
  sessionsStore.setState({ sessions: { s: { id: "s", harness, nativeId: "native", title: "Synthetic", state: "live", deleted: false, pendingApprovals: 0 } } });
  let stored = history;
  const feed = new SessionFeedService({ getSocket: () => null, fetchHistoryPage: async () => ({ entries: stored, has_more: false, next_cursor: null }) });
  feed.ensureSession("s", harness);
  let seq = 0;
  const sent: EventMessage[] = [];
  const send = (raw: unknown, ts: number) => {
    const frame: EventMessage = { topic: "session.s", source: harness, seq: ++seq, ts, raw };
    sent.push(frame);
    sessionsStore.getState().ingestFrame(frame);
    feed.ingestSessionFrame("s", harness, frame);
  };
  return { feed, send, setHistory: (entries: string[]) => { stored = entries; }, replay: () => {
    for (const frame of sent) {
      sessionsStore.getState().ingestFrame(frame);
      feed.ingestSessionFrame("s", harness, frame);
    }
  } };
}

it.each(harnesses)("%s renders one completed summary through live, replay, history merge and cold reload", async (harness) => {
  const fixture = turnFixture(harness);
  const { feed, send, setHistory, replay } = setup(harness);
  send(fixture.starts, fixture.start);
  expect(turns()).toHaveLength(1);
  expect(turnCompleted(turns()[0]!)).toBe(false);
  for (const body of fixture.bodies) send(body, fixture.start + 500);
  for (const finish of fixture.finishes) send(finish, fixture.end);
  expect(turns()).toHaveLength(1);
  expect(turns()[0]).toMatchObject({ startedAt: fixture.start, endedAt: fixture.end, outcome: "worked" });
  replay();
  expect(turns()).toHaveLength(1);
  expect(sessionsStore.getState().sessions.s!.nativeTurnActive).toBe(false);
  setHistory(fixture.history);
  await feed.loadHistory("s");
  await feed.loadHistory("s", { refresh: true, preserveOlder: true });
  expect(turns()).toHaveLength(1);
  expect(turns()[0]).toMatchObject({ startedAt: fixture.start, endedAt: fixture.end, outcome: "worked" });
  const view = render(<Transcript sessionId="s" harness={harness} feed={feed} />);
  await act(async () => {});
  expect(view.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(1);
  expect(view.container.querySelector(".transcript-turn-summary")?.textContent).toBe("Worked for 5s");
  view.unmount();
  feed.closeSession("s");
  sessionsStore.setState(sessionsStore.getInitialState());
  const cold = setup(harness, fixture.history);
  await cold.feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(turns()[0]?.outcome).toBe("worked");
  const markup = renderToStaticMarkup(<WorkingIndicator turn={turns()[0]} running={false} />);
  expect(markup).toContain(harness === "agy" ? ">Worked<" : ">Worked for 5s<");
});

it.each(harnesses)("%s keeps identical consecutive prompts as separate turns", async (harness) => {
  const first = turnFixture(harness);
  const second = turnFixture(harness, "two", 10000);
  const { feed, send, setHistory } = setup(harness);
  for (const fixture of [first, second]) {
    send(fixture.starts, fixture.start);
    for (const body of fixture.bodies) send(body, fixture.start + 500);
    for (const finish of fixture.finishes) send(finish, fixture.end);
  }
  setHistory([...first.history, ...second.history]);
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(2);
  expect(turns().map((turn) => turn.startedAt)).toEqual([1000, 10000]);
  expect(new Set(turns().map((turn) => turn.id)).size).toBe(2);
});

it.each(harnesses)("%s joins a turn split across history pages without duplicates", async (harness) => {
  const fixture = turnFixture(harness);
  setup(harness);
  const split = Math.floor(fixture.history.length / 2);
  const pages = [
    { entries: fixture.history.slice(split), has_more: true, next_cursor: "older" },
    { entries: fixture.history.slice(0, split), has_more: false, next_cursor: null },
  ];
  const feed = new SessionFeedService({ getSocket: () => null, fetchHistoryPage: async () => pages.shift()! });
  feed.ensureSession("s", harness);
  await feed.loadHistory("s");
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(turns()[0]).toMatchObject({ startedAt: fixture.start, outcome: "worked" });
});

it.each(harnesses)("%s preserves explicit interruption after history reconciliation", async (harness) => {
  const fixture = turnFixture(harness);
  const { send, setHistory, feed } = setup(harness);
  send(fixture.starts, fixture.start);
  for (const body of fixture.bodies) send(body, fixture.start + 500);
  const interrupt = new SessionFeedService({ getSocket: () => ({ request: vi.fn().mockResolvedValue({ interrupted: true }) }) });
  vi.spyOn(Date, "now").mockReturnValue(fixture.end);
  await interrupt.interrupt("s");
  setHistory(fixture.history);
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(turns()[0]?.outcome).toBe("stopped");
});

it("does not manufacture a duration for completed history without timestamps", async () => {
  const history = turnFixture("claude").history.map((line) => {
    const value = JSON.parse(line); delete value.timestamp; return JSON.stringify(value);
  });
  const { feed } = setup("claude", history);
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(renderToStaticMarkup(<WorkingIndicator turn={turns()[0]} running={false} />)).toContain(">Worked<");
});

it.each(harnesses)("%s never renders a summary for an unanswered prompt", async (harness) => {
  const fixture = turnFixture(harness);
  const userHistory = harness === "codex" ? fixture.history.slice(0, 2)
    : harness === "opencode" ? fixture.history.slice(0, 2) : fixture.history.slice(0, 1);
  const { feed } = setup(harness, userHistory);
  await feed.loadHistory("s");
  sessionsStore.getState().applySessionPatch("s", { nativeTurnActive: false });
  const view = render(<Transcript sessionId="s" harness={harness} feed={feed} />);
  await act(async () => {});
  expect(view.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(0);
});

it("does not render local Claude command records as completed agent work", async () => {
  const history = [
    { type: "user", uuid: "meta", isMeta: true, message: { role: "user", content: "<local-command-caveat>Local commands</local-command-caveat>" } },
    { type: "user", uuid: "command", message: { role: "user", content: "<command-name>/autocompact</command-name>" } },
    { type: "user", uuid: "stdout", message: { role: "user", content: "<local-command-stdout>Unchanged</local-command-stdout>" } },
  ].map((value) => JSON.stringify(value));
  const { feed } = setup("claude", history);
  await feed.loadHistory("s");
  const view = render(<Transcript sessionId="s" harness="claude" feed={feed} />);
  await act(async () => {});
  expect(view.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(0);
});

it("OpenCode keeps tool-call messages and final status transitions within one displayed turn", async () => {
  const fixture = turnFixture("opencode");
  const { feed, send } = setup("opencode");
  send(fixture.starts, fixture.start);
  for (const body of fixture.bodies) send(body, fixture.start + 500);
  for (const finish of fixture.finishes) send(finish, fixture.end);
  send(fixture.starts, fixture.end + 1);
  send(fixture.finishes.at(-1), fixture.end + 1);
  const view = render(<Transcript sessionId="s" harness="opencode" feed={feed} />);
  await act(async () => {});
  expect(view.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(1);
  expect(view.container.textContent).not.toContain("for 0s");
});

it.each([
  { startedAt: 1000, endedAt: 1000 },
  { startedAt: 1000, endedAt: 1100 },
  { startedAt: 1000, endedAt: 900 },
  { startedAt: undefined, endedAt: 2000 },
  { startedAt: NaN, endedAt: 2000 },
])("never displays a zero or invalid duration for %j", (timing) => {
  const markup = renderToStaticMarkup(<WorkingIndicator running={false} turn={{ id: "turn", firstNodeKey: "assistant:answer", outcome: "worked", ...timing }} />);
  expect(markup).toContain("Worked");
  expect(markup).not.toMatch(/for 0s|NaN|undefined/);
});

it.each(harnesses)("%s renders a failed lifecycle without converting it to success on refresh", async (harness) => {
  const fixture = turnFixture(harness);
  const { send, feed, setHistory } = setup(harness);
  send(fixture.starts, fixture.start);
  for (const body of fixture.bodies) send(body, fixture.start + 500);
  sessionsStore.getState().ingestFrame({ type: "session_stopped", topic: "session.s", seq: 100, source: "mandri",
    ts: fixture.end, raw: { session_id: "s", harness, state: "stopped", cause: "crash" } });
  setHistory(fixture.history);
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(turns()[0]).toMatchObject({ outcome: "failed", endedAt: fixture.end });
  expect(renderToStaticMarkup(<WorkingIndicator turn={turns()[0]} running={false} />)).toContain("Failed after 5s");
});

it("restores Claude native duration when assistant records have no stop reason", async () => {
  const fixture = turnFixture("claude");
  const history = fixture.history.map((line) => {
    const value = JSON.parse(line);
    if (value.type === "assistant") value.message.stop_reason = null;
    return JSON.stringify(value);
  });
  history.push(JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 5000, timestamp: new Date(fixture.end).toISOString() }));
  const { feed } = setup("claude", history);
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(turns()[0]).toMatchObject({ startedAt: fixture.start, endedAt: fixture.end, outcome: "worked" });
});

it("reconciles an OpenCode tool loop and mutable terminal message across history refreshes", async () => {
  const fixture = turnFixture("opencode");
  const entries = fixture.history.map((line) => JSON.parse(line));
  const intermediate = structuredClone(entries[2]);
  intermediate.properties.info.id = "tool-message";
  intermediate.properties.info.finish = "tool-calls";
  intermediate.properties.info.time.completed = fixture.start + 1000;
  const unfinished = structuredClone(entries[2]);
  delete unfinished.properties.info.time.completed;
  delete unfinished.properties.info.finish;
  const initial = [entries[0], entries[1], intermediate, unfinished, entries[3]].map((value) => JSON.stringify(value));
  const { feed, setHistory } = setup("opencode", initial);
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(turnCompleted(turns()[0]!)).toBe(false);
  setHistory([entries[2], entries[3]].map((value) => JSON.stringify(value)));
  await feed.loadHistory("s", { refresh: true, preserveOlder: true });
  expect(turns()).toHaveLength(1);
  expect(turns()[0]).toMatchObject({ startedAt: fixture.start, endedAt: fixture.end, outcome: "worked" });
});

it("Antigravity keeps multiple response steps after one user input in one historical turn", async () => {
  const fixture = turnFixture("agy");
  const response = JSON.parse(fixture.history[1]!);
  const history = [...fixture.history, JSON.stringify({ ...response, step_index: 2, content: "Additional response" })];
  const { feed } = setup("agy", history);
  await feed.loadHistory("s");
  expect(turns()).toHaveLength(1);
  expect(turns()[0]?.outcome).toBe("worked");
  const view = render(<Transcript sessionId="s" harness="agy" feed={feed} />);
  await act(async () => {});
  expect(view.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(1);
});

it.each(harnesses)("%s keeps Thinking visible between prompt delivery and native turn start", async (harness) => {
  const { feed, send } = setup(harness);
  transcriptStore.getState().addPendingUser("s", "Same prompt");
  sessionsStore.getState().applySessionPatch("s", { sending: true, awaitingResponse: true });
  const view = render(<Transcript sessionId="s" harness={harness} feed={feed} />);
  await act(async () => {});
  expect(view.getByRole("status").textContent).toBe("Thinking");
  expect(view.container.querySelector(".transcript-turn-summary")).toBeNull();
  act(() => sessionsStore.getState().applySessionPatch("s", { sending: false }));
  expect(view.getByRole("status").textContent).toBe("Thinking");
  const fixture = turnFixture(harness);
  act(() => send(fixture.starts, fixture.start));
  const rows = view.container.querySelectorAll(".transcript-item");
  expect(rows[1]?.querySelector(".transcript-turn-summary")).not.toBeNull();
  expect(view.container.querySelectorAll(".transcript-turn-summary")).toHaveLength(1);
});

it("preserves an expanded Claude block and its pending followup across history refreshes", async () => {
  const { feed, send, setHistory } = setup("claude");
  const user = { type: "user", uuid: "user", message: { content: "Start" } };
  const fragment = { type: "assistant", uuid: "fragment", message: { id: "message", content: [{ type: "thinking", thinking: "Detailed reasoning" }] } };
  send(user, 1000);
  send({ type: "stream_event", event: { type: "message_start", message: { id: "message" } } }, 2000);
  send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "Detailed reasoning" } } }, 2001);
  send(fragment, 2002);
  send({ type: "stream_event", event: { type: "message_stop" } }, 2003);
  const view = render(<Transcript sessionId="s" harness="claude" feed={feed} />);
  await act(async () => {});
  act(() => { transcriptStore.getState().addPendingUser("s", "Continue after reasoning"); });
  const disclosure = view.container.querySelector(".tr-thinking")!;
  fireEvent.click(disclosure.querySelector("button")!);
  const keys = feed.getNodes("s").map((node) => node.key);
  setHistory([user, fragment].map((entry) => JSON.stringify(entry)));
  for (let i = 0; i < 3; i++) {
    await act(async () => { await feed.loadHistory("s", { refresh: true, preserveOlder: true }); });
    expect(feed.getNodes("s").map((node) => node.key)).toEqual(keys);
    expect(view.container.querySelector(".tr-thinking")).toBe(disclosure);
    expect(disclosure.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    const text = view.container.textContent!;
    expect(text.indexOf("Detailed reasoning")).toBeLessThan(text.indexOf("Continue after reasoning"));
  }
});

it("moves foreground activity past a followup and ignores a previous running tool", async () => {
  const { feed, send } = setup("claude");
  send({ type: "user", uuid: "user", message: { content: "Start" } }, 1000);
  send({ type: "stream_event", event: { type: "message_start", message: { id: "message" } } }, 2000);
  send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "Earlier response" } } }, 2001);
  const view = render(<Transcript sessionId="s" harness="claude" feed={feed} />);
  await act(async () => {});
  expect(view.container.querySelector(".tr-caret")).not.toBeNull();
  act(() => { transcriptStore.getState().addPendingUser("s", "Continue"); });
  expect(view.container.querySelector(".tr-caret")).toBeNull();
  expect(view.getByRole("status").textContent).toBe("Thinking");
  act(() => send({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool", name: "Bash", input: { command: "pwd" } }] } }, 2002));
  act(() => send({ type: "stream_event", event: { type: "message_start", message: { id: "next" } } }, 2003));
  act(() => send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "Next reasoning" } } }, 2004));
  expect(view.container.querySelector(".tr-activity-group .tr-shimmer")).toBeNull();
  expect(view.container.querySelector(".tr-thinking .tr-shimmer")?.textContent).toBe("Thinking");
  expect(view.container.querySelector(".tr-caret")).toBeNull();
});

it("does not render the transcript for Claude events without a visible update", async () => {
  const { feed, send } = setup("claude");
  send({ type: "user", uuid: "user", message: { content: "Start" } }, 1000);
  send({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool", name: "Bash", input: { command: "pwd" } }] } }, 1001);
  const onRender = vi.fn();
  render(<Profiler id="transcript" onRender={onRender}><Transcript sessionId="s" harness="claude" feed={feed} /></Profiler>);
  await act(async () => {});
  onRender.mockClear();
  const session = sessionsStore.getState().sessions.s;
  for (let i = 0; i < 20; i++) {
    act(() => send({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: null } } }, 2000 + i));
  }
  expect(sessionsStore.getState().sessions.s).toBe(session);
  expect(onRender).not.toHaveBeenCalled();
});

it("keeps turn metadata stable across deltas of the same Claude block", () => {
  const { send } = setup("claude");
  send({ type: "user", uuid: "user", message: { content: "Start" } }, 1000);
  send({ type: "stream_event", event: { type: "message_start", message: { id: "message" } } }, 2000);
  send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "Reasoning" } } }, 2001);
  const before = turns();
  send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " more" } } }, 2002);
  expect(turns()).toBe(before);
});

it("does not anchor a new turn to an unfinished block from the previous turn", () => {
  const { send } = setup("claude");
  send({ type: "user", uuid: "user", message: { content: "Start" } }, 1000);
  send({ type: "stream_event", event: { type: "message_start", message: { id: "old" } } }, 2000);
  send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "Previous answer" } } }, 2001);
  send({ type: "result" }, 2002);
  transcriptStore.getState().addPendingUser("s", "Continue");
  send({ type: "stream_event", event: { type: "message_start", message: { id: "next" } } }, 3000);
  expect(turns()).toHaveLength(2);
  expect(turns().at(-1)?.firstNodeKey).toBeUndefined();
  send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "Next reasoning" } } }, 3001);
  expect(turns().at(-1)?.firstNodeKey).toBe("thinking:next:thinking:0");
});

it("keeps elapsed time advancing while turn metadata is updated", () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  try {
    const turn = { id: "turn", startedAt: 10000 };
    const view = render(<WorkingIndicator turn={turn} />);
    act(() => { vi.advanceTimersByTime(600); });
    view.rerender(<WorkingIndicator turn={{ ...turn, identities: ["new-block"] }} />);
    act(() => { vi.advanceTimersByTime(600); });
    expect(view.container.textContent).toContain("1s");
    view.unmount();
  } finally {
    vi.useRealTimers();
  }
});
