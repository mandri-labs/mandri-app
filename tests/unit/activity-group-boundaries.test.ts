import { beforeEach, expect, it, vi } from "vitest";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { groupActivities } from "@/features/transcript/activityGroups";
import { presentTranscript } from "@/features/transcript/presentation";
import { transcriptStore } from "@/stores/sessions";

beforeEach(() => transcriptStore.getState().resetTranscripts());
const sessionId = "activity-boundary";
const command = (id: string) => ({
  type: "commandExecution",
  id,
  command: "npm test",
  exitCode: 0,
});
const historyCall = (id: string) =>
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: id,
      arguments: JSON.stringify({ cmd: "npm test" }),
    },
  });

it.each([false, true])(
  "keeps a new command below the assistant message across refreshes (preserveOlder=%s)",
  async (preserveOlder) => {
    const entries = [historyCall("before")];
    const fetchHistoryPage = vi.fn(async () => ({
      entries: [...entries],
      next_cursor: null,
      has_more: false,
    }));
    const feed = new SessionFeedService({ fetchHistoryPage, getSocket: () => null });
    feed.ensureSession(sessionId, "codex");
    await feed.loadHistory(sessionId);
    let seq = 0;
    const send = (method: string, params: object) =>
      feed.ingestSessionFrame(sessionId, "codex", {
        topic: `session.${sessionId}`,
        source: "codex",
        seq: ++seq,
        ts: seq,
        raw: { method, params },
      });
    send("item/agentMessage/delta", { itemId: "message", delta: "Now checking the result." });
    send("item/started", { item: command("after") });
    const expectBoundary = () => {
      const rows = groupActivities(presentTranscript(feed.getNodes(sessionId)), true, 0);
      expect(rows).toMatchObject([
        { kind: "group", nodes: [{ kind: "tool", key: "before" }] },
        {
          kind: "node",
          node: { kind: "assistant", key: "message", text: "Now checking the result." },
        },
        { kind: "group", nodes: [{ kind: "tool", key: "after" }] },
      ]);
      expect(rows.filter((row) => row.kind === "group").map((row) => row.nodes.length)).toEqual([
        1, 1,
      ]);
      return rows.map((row) => row.key);
    };
    const keys = expectBoundary();
    entries.push(historyCall("after"));
    await feed.loadHistory(sessionId, { refresh: true, preserveOlder });
    expect(expectBoundary()).toEqual(keys);
    send("item/completed", { item: command("before") });
    send("item/completed", { item: command("after") });
    send("item/completed", {
      item: { type: "agentMessage", id: "message", text: "Now checking the result." },
    });
    expect(expectBoundary()).toEqual(keys);
    await feed.loadHistory(sessionId, { refresh: true, preserveOlder });
    expect(expectBoundary()).toEqual(keys);
    entries.splice(
      1,
      0,
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Now checking the result." }],
        },
      }),
    );
    await feed.loadHistory(sessionId, { refresh: true, preserveOlder });
    expect(expectBoundary()).toEqual(keys);
    await feed.loadHistory(sessionId, { refresh: true, preserveOlder });
    expect(expectBoundary()).toEqual(keys);
    expect(
      feed
        .getNodes(sessionId)
        .filter((node) => node.kind === "tool")
        .map((node) => node.status),
    ).toEqual(["done", "done"]);
  },
);
