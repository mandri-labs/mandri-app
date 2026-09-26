import { describe, expect, it } from "vitest";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";

const delta = (text: string, itemId = "r1") =>
  parseCodexEvent(
    {
      method: "item/reasoning/summaryTextDelta",
      params: { itemId, delta: text },
    },
    "codex",
  );
const completed = (summary: unknown, content?: unknown) =>
  parseCodexEvent(
    {
      method: "item/completed",
      params: { item: { type: "reasoning", id: "r1", summary, content } },
    },
    "codex",
  );

describe("Codex live reasoning", () => {
  it("shows streamed reasoning immediately and replaces it with the final snapshot", () => {
    let nodes = appendTranscriptNodes([], delta("First "));
    expect(nodes).toEqual([
      { kind: "thinking", key: "r1", text: "First ", summary: "First ", streaming: true },
    ]);
    nodes = appendTranscriptNodes(nodes, delta("part"));
    expect(nodes[0]).toMatchObject({ text: "First part", summary: "First part" });
    nodes = appendTranscriptNodes(nodes, completed(["First part", "Second part"]));
    expect(nodes).toEqual([
      {
        kind: "thinking",
        key: "r1",
        text: "First part\n\nSecond part",
        summary: "First part\n\nSecond part",
      },
    ]);
    const history = parseCodexHistoryLine(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "reasoning",
          id: "r1",
          summary: [
            { type: "summary_text", text: "First part" },
            { type: "summary_text", text: "Second part" },
          ],
        },
      }),
      "codex",
    );
    expect(nodes).toEqual(history);
  });

  it("supports content fallback and text deltas without merging distinct items", () => {
    expect(completed([], ["Content"])[0]).toMatchObject({ text: "Content" });
    expect(completed({ text: "Legacy" })[0]).toMatchObject({ text: "Legacy" });
    const raw = parseCodexEvent(
      { method: "item/reasoning/textDelta", params: { itemId: "r2", delta: "Other" } },
      "codex",
    );
    expect(appendTranscriptNodes(delta("First"), raw)).toHaveLength(2);
    expect(delta("")).toEqual([]);
    expect(completed([])).toEqual([]);
  });
});
