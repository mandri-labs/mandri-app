import { beforeEach, expect, it, vi } from "vitest";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { transcriptStore } from "@/stores/sessions";
import { DaemonError } from "@/daemon/errors";

beforeEach(() => transcriptStore.getState().resetTranscripts());

const history = (text: string) => ({
  entries: [
    JSON.stringify({
      type: "message.updated",
      properties: { info: { id: "message", role: "user" } },
    }),
    JSON.stringify({
      type: "message.part.updated",
      properties: { part: { id: "part", messageID: "message", type: "text", text } },
    }),
  ],
  next_cursor: null,
  has_more: false,
});

it("refreshes mutable OpenCode parts through WS notification without duplication", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(history("initial"))
    .mockResolvedValue(history("updated"));
  const feed = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  feed.ensureSession("one", "opencode");
  await feed.loadHistory("one");
  expect(feed.getNodes("one")).toEqual([
    expect.objectContaining({ kind: "user", text: "initial" }),
  ]);
  feed.ingestSessionFrame("one", "opencode", {
    topic: "session.one",
    seq: 1,
    source: "mandri",
    ts: 1,
    raw: { type: "history_changed" },
  });
  await vi.waitFor(() =>
    expect(feed.getNodes("one")).toEqual([
      expect.objectContaining({ kind: "user", text: "updated" }),
    ]),
  );
  feed.ingestSessionFrame("one", "opencode", {
    topic: "session.one",
    seq: 1,
    source: "mandri",
    ts: 1,
    raw: { type: "history_changed" },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("preserves older loaded messages when a new recent page arrives", async () => {
  const line = (text: string) =>
    JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      entries: [line("old"), line("recent")],
      next_cursor: null,
      has_more: false,
    })
    .mockResolvedValue({
      entries: [line("recent"), line("new")],
      next_cursor: "older",
      has_more: true,
    });
  const feed = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  feed.ensureSession("one", "codex");
  await feed.loadHistory("one");
  await feed.loadHistory("one", { refresh: true, preserveOlder: true });
  expect(feed.getNodes("one").map((node) => ("text" in node ? node.text : null))).toEqual([
    "old",
    "recent",
    "new",
  ]);
});

it("removes a transient history error after the store becomes available", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(
      new DaemonError({ code: "harness_store_unavailable", message: "temporarily unavailable" }),
    )
    .mockResolvedValue(history("recovered"));
  const feed = new SessionFeedService({ fetchHistoryPage: fetch, getSocket: () => null });
  feed.ensureSession("one", "opencode");
  await feed.loadHistory("one");
  expect(feed.getNodes("one").some((node) => node.kind === "system")).toBe(true);
  await feed.loadHistory("one", { refresh: true });
  expect(feed.getNodes("one")).toEqual([
    expect.objectContaining({ kind: "user", text: "recovered" }),
  ]);
});
