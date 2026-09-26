import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import en from "@/i18n/en.json";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";
import { parseClaudeEvent } from "@/features/transcript/parse/claude";
import { parseOpenCodeEvent } from "@/features/transcript/parse/opencode";
import { parseAgyEvent } from "@/features/transcript/parse/agy";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";
import { groupActivities } from "@/features/transcript/activityGroups";
import { activityKinds } from "@/features/transcript/activitySummary";
import { ActivityGroup } from "@/features/transcript/renderers/ActivityGroup";
import { consolidateFiles } from "@/features/transcript/fileChanges";
import { parseFileContents, parseUnifiedDiff } from "@/features/transcript/parse/shared";
import type { TranscriptNode } from "@/features/transcript/parse/types";

const i18n = createInstance();
await i18n.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
afterEach(cleanup);
const codex = (id: string, actions: unknown[], phase = "started") =>
  parseCodexEvent(
    {
      method: `item/${phase}`,
      params: {
        item: {
          type: "commandExecution",
          id,
          command: "cat config.json",
          commandActions: actions,
          exitCode: 0,
        },
      },
    },
    "codex",
  );
const patch = (id: string, text: string): TranscriptNode => ({
  kind: "diff",
  key: id,
  path: "config.txt",
  ...parseUnifiedDiff(text),
});

it("uses native reads in the active title and all native actions in the completed summary", () => {
  const read = codex("read", [{ type: "read", path: "config.json", name: "config.json" }]);
  const command = codex("command", [{ type: "unknown", command: "npm test" }]);
  const ui = (nodes: TranscriptNode[], active: boolean) => (
    <I18nextProvider i18n={i18n}>
      <ActivityGroup nodes={nodes} active={active} sessionId="native" />
    </I18nextProvider>
  );
  const view = render(ui(read, true));
  expect(screen.getByRole("button").textContent).toContain("Reading config.json");
  expect(view.container.querySelector(".lucide-book-open")).not.toBeNull();
  expect(view.container.querySelector(".tr-activity-title.tr-shimmer")).not.toBeNull();
  view.rerender(ui([...read, ...command], true));
  expect(screen.getByRole("button").textContent).toContain("npm test");
  const done = appendTranscriptNodes(
    [...read, ...command],
    codex("command", [{ type: "unknown", command: "npm test" }], "completed"),
  );
  view.rerender(ui(done, true));
  expect(screen.getByRole("button").textContent).toContain("Reading config.json");
  const finished = appendTranscriptNodes(
    done,
    codex("read", [{ type: "read", path: "config.json" }], "completed"),
  );
  view.rerender(ui(finished, true));
  expect(screen.getByRole("button").textContent).toContain("Thinking");
  expect(view.container.querySelector(".lucide-book-open")).toBeNull();
  view.rerender(ui(finished, false));
  expect(screen.getByRole("button").textContent).toContain("Read files");
  expect(screen.getByRole("button").textContent).toContain("commands");
  expect(view.container.querySelector(".tr-shimmer")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  expect(view.container.querySelectorAll(".tr-tool")).toHaveLength(2);
});

it.each([
  "cat 'config file.json'",
  'pwsh -NoProfile -Command "Get-Content -LiteralPath config.json -Raw"',
])("classifies supported metadata-poor Codex reads: %s", (command) => {
  const nodes = parseCodexHistoryLine(
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "fallback",
        arguments: JSON.stringify({ cmd: command }),
      },
    }),
    "codex",
  );
  expect(activityKinds(nodes)).toEqual(["read"]);
});

it("retains parsed commands from Codex history and respects native Unknown", () => {
  const history = parseCodexHistoryLine(
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "exec_command_begin",
        call_id: "ps",
        command: ["pwsh", "-Command", "Get-Content config.json"],
        parsed_cmd: [
          {
            type: "read",
            path: "config.json",
            name: "config.json",
            cmd: "Get-Content config.json",
          },
        ],
      },
    }),
    "codex",
  );
  expect(activityKinds(history)).toEqual(["read"]);
  expect(
    activityKinds(codex("mixed", [{ type: "unknown", command: "cat config.json; npm test" }])),
  ).toEqual(["command"]);
});

it.each([
  "cat file.txt; npm test",
  "cat $(echo secret)",
  "cat *.json",
  "type config.json",
  "gc config.json",
])("does not invent read semantics for unsupported history: %s", (command) => {
  const nodes = parseCodexHistoryLine(
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "unknown",
        arguments: JSON.stringify({ cmd: command }),
      },
    }),
    "codex",
  );
  expect(activityKinds(nodes)).toEqual(["command"]);
});

it("never replaces native Unknown actions with a historical fallback", () => {
  const original = codex("same", [{ type: "unknown", command: "cat config.json" }], "completed");
  const fallback = parseCodexHistoryLine(
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "same",
        arguments: JSON.stringify({ cmd: "cat config.json" }),
      },
    }),
    "codex",
  );
  const merged = appendTranscriptNodes(original, fallback);
  expect(activityKinds(merged)).toEqual(["command"]);
  expect(merged[0]).toMatchObject({ status: "done", actionSource: "native" });
});

it("does not describe a failed or unfinished read as a successful read", () => {
  const nodes: TranscriptNode[] = [
    { kind: "tool", tool: "Read", label: "Read", status: "failed", key: "failure" },
  ];
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ActivityGroup nodes={nodes} active={false} sessionId="failed" />
    </I18nextProvider>,
  );
  expect(screen.getByRole("button").textContent).toContain("Failed tools");
  expect(screen.getByRole("button").textContent).not.toContain("Read files");
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <ActivityGroup
        nodes={[{ ...nodes[0]!, kind: "tool", tool: "Read", label: "Read", status: "running" }]}
        active={false}
        sessionId="failed"
      />
    </I18nextProvider>,
  );
  expect(screen.getByRole("button").textContent).toContain("Unfinished tool calls");
});

it("correlates Claude progress and native summaries without creating extra calls or regressing completion", () => {
  let nodes = parseClaudeEvent(
    {
      type: "assistant",
      message: {
        id: "m",
        content: [
          {
            type: "tool_use",
            id: "call",
            name: "Bash",
            input: { command: "npm test", description: "Check the configuration" },
          },
        ],
      },
    },
    "claude",
  );
  const progress = parseClaudeEvent(
    { type: "tool_progress", tool_name: "Bash", tool_use_id: "call", elapsed_time_seconds: 12 },
    "claude",
  );
  nodes = appendTranscriptNodes(nodes, progress);
  expect(nodes).toMatchObject([
    {
      title: "Check the configuration",
      target: "npm test",
      durationMs: 12000,
      details: { input: { command: "npm test" } },
    },
  ]);
  nodes = appendTranscriptNodes(
    nodes,
    parseClaudeEvent(
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "call", content: "passed" }] },
      },
      "claude",
    ),
  );
  nodes = appendTranscriptNodes(nodes, progress);
  expect(nodes).toMatchObject([{ status: "done", details: { output: "passed" } }]);
  nodes.push(
    ...parseClaudeEvent(
      {
        type: "tool_use_summary",
        summary: "Checked the configuration",
        preceding_tool_use_ids: ["call"],
        uuid: "s",
      },
      "claude",
    ),
  );
  expect(groupActivities(nodes, true, 0)[0]).toMatchObject({
    kind: "group",
    summary: "Checked the configuration",
    active: false,
  });
  nodes.push({ kind: "tool", tool: "Read", label: "Read", key: "later", status: "running" });
  expect(groupActivities(nodes, true, 0)[0]).toMatchObject({ summary: undefined, active: true });
});

it("keeps OpenCode pending state and per-file patch metadata separate from session snapshots", () => {
  const event = (state: object) =>
    parseOpenCodeEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part",
            callID: "call",
            messageID: "m",
            sessionID: "session",
            type: "tool",
            tool: "apply_patch",
            state,
          },
        },
      },
      "opencode",
    );
  expect(event({ status: "pending", input: { patchText: "partial" } })).toMatchObject([
    { status: "pending" },
  ]);
  const nodes = event({
    status: "completed",
    input: {},
    time: { start: 10, end: 40 },
    metadata: {
      files: [
        { filePath: "a.txt", type: "add", patch: "@@ -0,0 +1 @@\n+a" },
        { filePath: "b.txt", type: "add", patch: "@@ -0,0 +1 @@\n+b" },
      ],
    },
    output: "done",
  });
  expect(nodes.filter((node) => node.kind === "diff").map((node) => node.path)).toEqual([
    "a.txt",
    "b.txt",
  ]);
  expect(nodes[0]).toMatchObject({
    native: { callId: "call", messageId: "m", partId: "part" },
    durationMs: 30,
  });
  const snapshot = parseOpenCodeEvent(
    {
      type: "session.diff",
      properties: { sessionID: "session", diff: [{ file: "a.txt", additions: 1, deletions: 0 }] },
    },
    "opencode",
  );
  expect(snapshot).toMatchObject([{ kind: "file_snapshot", scope: "session" }]);
  expect(appendTranscriptNodes(snapshot, snapshot)).toHaveLength(1);
  expect(
    groupActivities([...nodes, ...snapshot], true, 0).filter((row) => row.kind === "group"),
  ).toHaveLength(1);
});

it("preserves agy descriptions, duration, errors and subagent metadata", () => {
  const nodes = parseAgyEvent(
    {
      event: "step_update",
      step_update: {
        conversation_id: "native",
        step_index: 2,
        state: "DONE",
        step_type: "tool",
        duration_seconds: 2.5,
        tool_info: {
          name: "view_file",
          parameters: { AbsolutePath: "config.json", toolSummary: "Inspect configuration" },
          output: "{}",
        },
        subagent_info: { subagents: [{ conversation_id: "child", role: "reviewer" }] },
      },
    },
    "agy",
    { sessionId: "session" },
  );
  expect(nodes[0]).toMatchObject({
    title: "Inspect configuration",
    durationMs: 2500,
    status: "done",
    actions: [{ kind: "read" }],
    native: { subagents: [{ conversation_id: "child" }] },
  });
});

it("correlates agy hooks by their supplied call ID and preserves a failed result", () => {
  const context = { sessionId: "hook-session" };
  const toolCall = { id: "native-call", name: "view_file", args: { AbsolutePath: "config.json" } };
  const started = parseAgyEvent(
    { event: "hook", hook: "PreToolUse", data: { toolCall } },
    "agy",
    context,
  );
  const completed = parseAgyEvent(
    {
      event: "hook",
      hook: "PostToolUse",
      data: { toolCall, toolResult: { id: "native-call", error: "File missing" } },
    },
    "agy",
    context,
  );
  expect(appendTranscriptNodes(started, completed)).toMatchObject([
    {
      key: "agy:hook-session:call:native-call",
      status: "failed",
      details: { output: "File missing" },
    },
  ]);
});

it("combines edits into a net diff, including reverted lines and sparse hunks", () => {
  const edits = [
    patch("a", "@@ -10 +10 @@\n-original\n+temporary"),
    patch("b", "@@ -10 +10 @@\n-temporary\n+final"),
  ];
  expect(consolidateFiles(edits)).toMatchObject([
    { path: "config.txt", additions: 1, deletions: 1 },
  ]);
  expect(
    consolidateFiles(edits)[0]
      ?.lines?.filter((line) => line.type !== "context")
      .map((line) => line.text),
  ).toEqual(["original", "final"]);
  expect(consolidateFiles([...edits, patch("c", "@@ -10 +10 @@\n-final\n+original")])).toEqual([]);
});

it("combines creation followed by editing into one file and removes a created-then-deleted file", () => {
  const created: TranscriptNode = {
    kind: "diff",
    change: "add",
    key: "created",
    path: "config.txt",
    ...parseFileContents("one\ntwo\n", "add"),
  };
  expect(consolidateFiles([created, patch("edit", "@@ -2 +2 @@\n-two\n+three")])).toMatchObject([
    { additions: 2, deletions: 0 },
  ]);
  const deleted: TranscriptNode = {
    kind: "diff",
    change: "delete",
    key: "deleted",
    path: "config.txt",
    ...parseFileContents("one\ntwo\n", "del"),
  };
  expect(consolidateFiles([created, deleted])).toEqual([]);
});

it("retains renames and empty file creations in the final file summary", () => {
  expect(
    consolidateFiles([
      { kind: "diff", path: "new.txt", oldPath: "old.txt", additions: 0, deletions: 0 },
    ]),
  ).toHaveLength(1);
  expect(
    consolidateFiles([
      { kind: "diff", path: "empty.txt", change: "add", additions: 0, deletions: 0 },
    ]),
  ).toHaveLength(1);
});
