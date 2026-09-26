import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
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
