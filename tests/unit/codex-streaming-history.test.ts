import { beforeEach, expect, it, vi } from "vitest";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { transcriptStore } from "@/stores/sessions";

beforeEach(() => transcriptStore.getState().resetTranscripts());

const page = (text?: string) => ({ entries: text === undefined ? [] : [JSON.stringify({ type: "response_item", payload: {
  type: "message", id: "answer", role: "assistant", content: [{ type: "output_text", text }],
} })], next_cursor: null, has_more: false });

it("keeps Codex streamed text when stale history overlaps its node and a gap refresh omits it", async () => {
  const fetchHistoryPage = vi.fn().mockResolvedValueOnce(page("First"))
    .mockResolvedValueOnce(page("First"))
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page("First"))
    .mockResolvedValueOnce(page())
    .mockResolvedValue(page("First second third"));
  const feed = new SessionFeedService({ fetchHistoryPage, getSocket: () => null });
  feed.ensureSession("stream", "codex");
  await feed.loadHistory("stream");
  const delta = (seq: number, text: string) => feed.ingestSessionFrame("stream", "codex", {
    topic: "session.stream", seq, ts: seq, source: "codex", raw: {
      method: "item/agentMessage/delta", params: { itemId: "answer", delta: text },
    },
  });
  delta(1, " second");
  expect(feed.getNodes("stream")).toMatchObject([{ text: "First second", streaming: true }]);
  await feed.loadHistory("stream", { refresh: true, preserveOlder: true });
  expect(feed.getNodes("stream")).toMatchObject([{ text: "First second", streaming: true }]);
  await feed.loadHistory("stream", { refresh: true });
  expect(feed.getNodes("stream")).toMatchObject([{ text: "First second", streaming: true }]);
  delta(2, " third");
  expect(feed.getNodes("stream")).toMatchObject([{ text: "First second third", streaming: true }]);
  feed.ingestSessionFrame("stream", "codex", { topic: "session.stream", seq: 3, ts: 3, source: "codex", raw: {
    method: "item/completed", params: { item: { type: "agentMessage", id: "answer", text: "First second third" } },
  } });
  await feed.loadHistory("stream", { refresh: true, preserveOlder: true });
  expect(feed.getNodes("stream")).toMatchObject([{ text: "First second third" }]);
  await feed.loadHistory("stream", { refresh: true });
  expect(feed.getNodes("stream")).toMatchObject([{ text: "First second third" }]);
  await feed.loadHistory("stream", { refresh: true });
  expect(feed.getNodes("stream")).toMatchObject([{ kind: "assistant", key: "answer", text: "First second third" }]);
  expect(feed.getNodes("stream")).toHaveLength(1);
});
