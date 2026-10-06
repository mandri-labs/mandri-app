import { renderToStaticMarkup } from "react-dom/server";
import { ToolLine } from "@/features/transcript/renderers/ToolLine";
import { WorkingIndicator } from "@/features/transcript/WorkingIndicator";
import { initI18n } from "@/i18n";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";
import { mergeHistoryAndLive } from "@/daemon/ws/transcriptMerge";
import { parseClaudeEvent, parseClaudeHistoryLine } from "@/features/transcript/parse/claude";
import { parseOpenCodeEvent } from "@/features/transcript/parse/opencode";
import { parseUnifiedDiff } from "@/features/transcript/parse/shared";
import { fitFilePath } from "@/features/transcript/renderers/FilePath";
import claude from "../fixtures/claude/tools-diff.json";
import opencode from "../fixtures/opencode/tools-diff.json";

beforeAll(async () => {
  await initI18n("en");
});

function codexChange(kind: string, diff: string, status = "completed") {
  return parseCodexEvent(
    {
      method: "item/completed",
      params: {
        item: {
          type: "fileChange",
          id: "edit-1",
          status,
          changes: [{ path: "/workspace/src/file.ts", kind: { type: kind }, diff }],
        },
      },
    },
    "codex",
  ).find((node) => node.kind === "diff");
}

describe("file change protocols", () => {
  it("restores completed Codex file changes from rollout history without a turn-completed event", () => {
    const stored = (status = "completed") =>
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "active-turn",
          item: {
            type: "FileChange",
            id: "edit-history",
            status,
            stdout: "Success",
            stderr: "",
            changes: {
              "/workspace/new.py": { type: "add", content: "one\n\nthree\n" },
              "C:\\project\\existing.py": {
                type: "update",
                unified_diff: "@@ -9 +9 @@\n-old\n+new\n",
                move_path: null,
              },
              "/workspace/removed.py": { type: "delete", content: "removed\n" },
            },
          },
        },
      });
    const history = parseCodexHistoryLine(stored(), "codex");
    expect(history.filter((node) => node.kind === "diff")).toMatchObject([
      {
        path: "/workspace/new.py",
        additions: 3,
        deletions: 0,
        lines: [{ newNo: 1 }, { newNo: 2 }, { newNo: 3 }],
      },
      {
        path: "C:\\project\\existing.py",
        additions: 1,
        deletions: 1,
        lines: [{ oldNo: 9 }, { newNo: 9 }],
      },
      { path: "/workspace/removed.py", additions: 0, deletions: 1, lines: [{ oldNo: 1 }] },
    ]);
    const live = parseCodexEvent(
      {
        method: "item/completed",
        params: {
          item: {
            type: "fileChange",
            id: "edit-history",
            status: "completed",
            changes: [
              { path: "/workspace/removed.py", kind: { type: "delete" }, diff: "removed\n" },
              { path: "/workspace/new.py", kind: { type: "add" }, diff: "one\n\nthree\n" },
              {
                path: "C:\\project\\existing.py",
                kind: { type: "update" },
                diff: "@@ -9 +9 @@\n-old\n+new\n",
              },
            ],
          },
        },
      },
      "codex",
    );
    const diffNodes = (nodes: typeof history) => nodes.filter((node) => node.kind === "diff");
    expect(diffNodes(mergeHistoryAndLive(history, live))).toEqual(diffNodes(history));
    for (const status of ["failed", "declined"]) {
      expect(diffNodes(parseCodexHistoryLine(stored(status), "codex"))).toEqual([]);
    }
    expect(
      parseCodexHistoryLine(
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: { type: "AgentMessage", text: "Already supplied by response_item" },
          },
        }),
        "codex",
      ),
    ).toEqual([]);
  });
  it("decodes literal Codex add/delete contents, including blank and diff-like lines", () => {
    const content = "import dataclasses\n\n+literal\n--- literal\n";
    expect(codexChange("add", content)).toMatchObject({
      additions: 4,
      deletions: 0,
      lines: [
        { type: "add", newNo: 1, text: "import dataclasses" },
        { type: "add", newNo: 2, text: "" },
        { type: "add", newNo: 3, text: "+literal" },
        { type: "add", newNo: 4, text: "--- literal" },
      ],
    });
    expect(codexChange("delete", "one\r\ntwo")).toMatchObject({
      additions: 0,
      deletions: 2,
      lines: [
        { type: "del", oldNo: 1, text: "one" },
        { type: "del", oldNo: 2, text: "two" },
      ],
    });
    expect(codexChange("add", "")).toMatchObject({ additions: 0, lines: [] });
    expect(codexChange("add", "no\n", "failed")).toBeUndefined();
  });
  it("keeps real update hunk numbers and does not invent line zero", () => {
    expect(codexChange("update", "@@ -12,2 +12,2 @@\n-old\n+new\n context\n")).toMatchObject({
      additions: 1,
      deletions: 1,
      lines: [
        { type: "del", oldNo: 12 },
        { type: "add", newNo: 12 },
        { type: "context", oldNo: 13, newNo: 13 },
      ],
    });
    expect(
      parseUnifiedDiff("-old\n+new").lines.every(
        (line) => line.newNo === undefined && line.oldNo === undefined,
      ),
    ).toBe(true);
  });
  it("decodes Claude structured patches from real live and history captures", () => {
    const live = claude.frames
      .flatMap(({ frame }) => parseClaudeEvent(frame.raw, "claude"))
      .filter((node) => node.kind === "diff");
    const history = claude.history.entries
      .flatMap((line) => parseClaudeHistoryLine(line, "claude"))
      .filter((node) => node.kind === "diff");
    for (const nodes of [live, history]) {
      expect(nodes).toHaveLength(3);
      expect(nodes.at(-1)).toMatchObject({ additions: 5, deletions: 1 });
      expect(
        nodes.every((node) => node.lines?.every((line) => line.oldNo !== 0 && line.newNo !== 0)),
      ).toBe(true);
    }
  });
  it("keeps real OpenCode edit patches and stable identities", () => {
    const nodes = opencode.frames
      .flatMap(({ frame }) => parseOpenCodeEvent(frame.raw, "opencode"))
      .filter((node) => node.kind === "diff");
    expect(nodes.at(-1)).toMatchObject({ additions: 5, deletions: 1 });
    expect(nodes.at(-1)?.lines?.some((line) => line.type === "add")).toBe(true);
    expect(nodes.at(-1)?.key).toBeTruthy();
  });
});

describe("file path fitting", () => {
  it.each([
    "/home/user/project/src/features/prompt.py",
    "C:\\Users\\user\\project\\src\\features\\prompt.py",
    "\\\\server\\share\\project\\src\\features\\prompt.py",
  ])("keeps as much context as fits: %s", (path) => {
    expect(fitFilePath(path, () => true)).toBe(path);
    const fitted = fitFilePath(path, (text) => text.length <= 26);
    expect(fitted).toMatch(/^…[/\\]src[/\\]features[/\\]prompt.py$/);
    expect(fitFilePath(path, () => false)).toMatch(/^…[/\\]prompt.py$/);
  });
});

it("hides subsecond tool durations but keeps completed-turn summaries", () => {
  expect(
    renderToStaticMarkup(<ToolLine tool="bash" label="Shell" status="done" durationMs={999} />),
  ).not.toContain("tr-tool-duration");
  expect(
    renderToStaticMarkup(<ToolLine tool="bash" label="Shell" status="done" durationMs={1000} />),
  ).toContain("1 s");
  expect(
    renderToStaticMarkup(
      <WorkingIndicator
        turn={{ id: "turn", startedAt: 1000, endedAt: 1999, firstNodeKey: "assistant:answer" }}
        running={false}
      />,
    ),
  ).toContain("Worked for &lt;1s");
});
