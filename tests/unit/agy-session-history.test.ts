import { beforeEach, expect, it } from "vitest";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import type { HistoryPage } from "@/daemon/ws/sessionFeed";
import { transcriptStore } from "@/stores/sessions";

const line = (index: number, type: string, fields: Record<string, unknown>) =>
  JSON.stringify({ step_index: index, type, source: "MODEL", status: "DONE", ...fields });
const first = line(0, "PLANNER_RESPONSE", { content: "First response" });
const planner = line(1, "PLANNER_RESPONSE", {
  tool_calls: [{ name: "run_command", args: { CommandLine: "printf result" } }],
});
const output = line(2, "GENERIC", { content: "result" });
const second = line(3, "PLANNER_RESPONSE", { content: "Second response" });
const third = line(4, "PLANNER_RESPONSE", { content: "Third response" });
const page = (entries: string[], next_cursor: string | null = null): HistoryPage => ({
  entries,
  next_cursor,
  has_more: next_cursor !== null,
});

beforeEach(() => transcriptStore.getState().resetTranscripts());

it("preserves all replies through live turns, resubscription and complete reload", async () => {
  let stored = [first];
  const feed = new SessionFeedService({
    fetchHistoryPage: async () => page(stored),
    getSocket: () => null,
  });
  feed.ensureSession("session", "agy");
  await feed.loadHistory("session");
  let seq = 1;
  for (const [index, text, rows] of [
    [3, "Second response", [first, planner, output, second]],
    [4, "Third response", [first, planner, output, second, third]],
  ] as const) {
    feed.ingestSessionFrame("session", "agy", {
      topic: "session.session",
      seq: seq++,
      ts: 0,
      source: "agy",
      raw: {
        event: "step_update",
        step_update: {
          conversation_id: "native",
          step_index: index,
          step_type: "agent_response",
          state: "ACTIVE",
          text_delta: text,
        },
      },
    });
    feed.ingestSessionFrame("session", "agy", {
      topic: "session.session",
      seq: seq++,
      ts: 0,
      source: "agy",
      raw: {
        event: "step_update",
        step_update: {
          conversation_id: "native",
          step_index: index,
          step_type: "agent_response",
          state: "DONE",
        },
      },
    });
    stored = [...rows];
    feed.ingestSessionFrame("session", "agy", {
      op: "subscribed",
      topic: "session.session",
      from_seq: seq,
    });
    await feed.loadHistory("session");
    expect(
      feed
        .getNodes("session")
        .filter((node) => node.kind === "assistant")
        .map((node) => node.text),
    ).toEqual(
      index === 3
        ? ["First response", "Second response"]
        : ["First response", "Second response", "Third response"],
    );
  }
  feed.closeSession("session");
  feed.ensureSession("session", "agy");
  await feed.loadHistory("session");
  expect(
    feed
      .getNodes("session")
      .filter((node) => node.kind === "assistant")
      .map((node) => node.text),
  ).toEqual(["First response", "Second response", "Third response"]);
  expect(feed.getNodes("session").filter((node) => node.kind === "tool")).toEqual([
    expect.objectContaining({
      tool: "run_command",
      target: "printf result",
      details: expect.objectContaining({ output: "result" }),
    }),
  ]);
});

it("resolves a paginated tool result when its earlier planner page arrives", async () => {
  const pages = [page([output, second], "older"), page([first, planner])];
  const feed = new SessionFeedService({
    fetchHistoryPage: async () => pages.shift()!,
    getSocket: () => null,
  });
  feed.ensureSession("session", "agy");
  await feed.loadHistory("session");
  expect(feed.getNodes("session").filter((node) => node.kind === "tool")).toHaveLength(1);
  await feed.loadHistory("session");
  expect(feed.getNodes("session").filter((node) => node.kind === "tool")).toEqual([
    expect.objectContaining({
      tool: "run_command",
      target: "printf result",
      details: expect.objectContaining({ output: "result" }),
    }),
  ]);
  expect(
    feed
      .getNodes("session")
      .filter((node) => node.kind === "assistant")
      .map((node) => node.text),
  ).toEqual(["First response", "Second response"]);
});
