import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { parseOpenCodeEvent } from "@/features/transcript/parse/opencode";
import { TranscriptNodeRenderer } from "@/features/transcript/renderers/TranscriptNodeRenderer";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";
import {
  isSessionBusy,
  isSessionWorking,
  nativeCompactionActive,
} from "@/features/transcript/turnActivity";
import { consolidateFiles } from "@/features/transcript/fileChanges";
import { Composer } from "@/features/transcript/Composer";
import { sessionsStore } from "@/stores/sessions";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { resetCommandCatalogs } from "@/features/commands/catalogCache";
import type { CommandTransport } from "@/features/commands/service";
import { opencodeNotificationNode } from "@/features/transcript/parse/opencodeNotifications";

beforeAll(() => initI18n("en"));
beforeEach(() => {
  resetCommandCatalogs();
  sessionsStore.setState({
    sessions: {
      s: {
        id: "s",
        harness: "opencode",
        state: "live",
        nativeId: "root",
        nativeAgent: "build",
        interactionMode: "default",
        deleted: false,
        title: "Session",
        pendingApprovals: 0,
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const patch = "--- /dev/null\n+++ b/hello.py\n@@ -0,0 +1 @@\n+hello\n";
const files = [{ file: "hello.py", patch, status: "added", additions: 1, deletions: 0 }];

it("renders Windows background shell notifications without raw transport tags", () => {
  const command = '& "D:\\Workspace\\python.exe" "task.py"';
  const text = `<shell id="sh_job" state="completed" command="${command}">\n(no output)\n</shell>`;
  const node = opencodeNotificationNode(text, "result");
  expect(node).toMatchObject({ kind: "tool", tool: "shell", target: command, status: "done" });
  const view = render(<TranscriptNodeRenderer node={node!} />);
  fireEvent.click(view.getByRole("button"));
  expect(view.container.textContent).not.toContain("<shell");
  expect(view.container.textContent).toContain("No recorded output.");
  expect(view.container.textContent).toContain(command);
});

it.each(["completed", "error", "cancelled"])(
  "renders %s subagent notifications with their result",
  (state) => {
    const text = `<subagent sessionID="child" state="${state}" description="Review files">\nResult from the agent\n</subagent>`;
    const node = opencodeNotificationNode(text, "agent-result");
    expect(node).toMatchObject({
      kind: "tool",
      tool: "subagent",
      title: "Review files",
      detailText: "Result from the agent",
      native: { metadata: { sessionID: "child" } },
    });
    expect(node?.kind === "tool" && node.status).toBe(
      state === "completed" ? "done" : state === "error" ? "failed" : "cancelled",
    );
  },
);

it("unwraps native subagent tool results and preserves user examples", () => {
  const text = '<subagent sessionID="child" state="completed">\nReport\n</subagent>';
  const result = parseOpenCodeEvent(
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "subagent",
          id: "call",
          state: { status: "completed", input: { description: "Review" }, output: text },
        },
      },
    },
    "opencode",
  );
  expect(result[0]).toMatchObject({ kind: "tool", detailText: "Report" });
  const user = parseOpenCodeEvent(
    {
      type: "message.part.updated",
      properties: { part: { type: "text", messageID: "user", text } },
    },
    "opencode",
    { messageRoles: new Map([["user", "user"]]) },
  );
  expect(user[0]).toMatchObject({ kind: "user", text });
  expect(opencodeNotificationNode("```xml\n" + text + "\n```")).toBeUndefined();
});

it("recognizes shell results returned by a generic execution tool", () => {
  const text = '<shell id="sh_job" state="error" command="exit 1">\nCommand failed\n</shell>';
  const nodes = parseOpenCodeEvent(
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "execute",
          callID: "call",
          state: { status: "completed", input: { code: "run()" }, output: text },
        },
      },
    },
    "opencode",
  );
  expect(nodes[0]).toMatchObject({
    kind: "tool",
    tool: "shell",
    target: "exit 1",
    status: "failed",
    detailText: "Command failed",
    actions: [{ kind: "command", target: "exit 1" }],
  });
});

it("reads OpenCode 2.0 edit metadata and aligns live snapshots with stored turn diffs", () => {
  const tool = parseOpenCodeEvent(
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "edit",
          callID: "edit",
          state: { status: "completed", input: {}, metadata: { files } },
        },
      },
    },
    "opencode",
  );
  expect(tool[1]).toMatchObject({ kind: "diff", path: "hello.py", change: "add", additions: 1 });
  const live = parseOpenCodeEvent(
    {
      type: "session.diff",
      properties: { sessionID: "root", scope: "turn", turnID: "user", diff: files },
    },
    "opencode",
  );
  const stored = parseOpenCodeEvent(
    {
      type: "message.part.updated",
      properties: { part: { type: "file_snapshot", id: "idle:files", turnID: "user", files } },
    },
    "opencode",
  );
  expect(live).toEqual(stored);
  expect(appendTranscriptNodes(live, stored)).toHaveLength(1);
});

it.each([
  "one\n\n+literal\n---literal\n",
  "one\r\n\r\n+literal\r\n---literal",
  "\uFEFFone\n\n+literal\n---literal\n",
])("shows the complete created file with line counts from a confirmed write", (content) => {
  const event = {
    type: "message.part.updated",
    properties: {
      part: {
        type: "tool",
        tool: "write",
        callID: "write-new",
        state: {
          status: "completed",
          input: { path: "/workspace/new.py", content },
          output: "Created file successfully: new.py",
        },
      },
    },
  };
  const nodes = parseOpenCodeEvent(event, "opencode");
  expect(nodes[1]).toMatchObject({
    kind: "diff",
    path: "/workspace/new.py",
    change: "add",
    additions: 4,
    deletions: 0,
    lines: [
      { type: "add", newNo: 1, text: "one" },
      { type: "add", newNo: 2, text: "" },
      { type: "add", newNo: 3, text: "+literal" },
      { type: "add", newNo: 4, text: "---literal" },
    ],
  });
  expect(appendTranscriptNodes(nodes, parseOpenCodeEvent(event, "opencode"))).toHaveLength(2);
  const empty = parseOpenCodeEvent(
    {
      type: "session.diff",
      properties: {
        scope: "turn",
        turnID: "user",
        diff: [],
      },
    },
    "opencode",
  );
  expect(consolidateFiles([...nodes, ...empty])[0]).toMatchObject({ additions: 4, deletions: 0 });
  const view = render(<TranscriptNodeRenderer node={nodes[1]!} />);
  expect(view.container.textContent).toContain("+4");
  fireEvent.click(view.getByRole("button"));
  expect(view.container.textContent).toContain("+literal");
  expect(view.container.textContent).toContain("---literal");
});

it.each([
  ["completed", "Wrote file successfully: new.py"],
  ["error", "Created file successfully: new.py"],
  ["running", "Created file successfully: new.py"],
])("does not invent a creation diff for %s writes with output %s", (status, output) => {
  expect(
    parseOpenCodeEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "write",
            callID: "write",
            state: {
              status,
              output,
              input: { path: "new.py", content: "one\n" },
            },
          },
        },
      },
      "opencode",
    ),
  ).toHaveLength(1);
});

it("keeps a delayed native diff in its original turn and uses its formatted contents", () => {
  const first = { kind: "user" as const, key: "first:text", messageId: "first", text: "Create" };
  const second = { kind: "user" as const, key: "second:text", messageId: "second", text: "Next" };
  const live = parseOpenCodeEvent(
    {
      type: "session.diff",
      properties: {
        scope: "turn",
        turnID: "first",
        diff: files,
      },
    },
    "opencode",
  );
  const nodes = appendTranscriptNodes([first, second], live);
  expect(nodes.map((node) => node.key)).toEqual([
    "first:text",
    "opencode:files:first",
    "second:text",
  ]);
  expect(appendTranscriptNodes(nodes, live)).toHaveLength(3);
  expect(consolidateFiles(nodes.slice(0, 2))[0]).toMatchObject({
    additions: 1,
    lines: [{ text: "hello" }],
  });
  expect(consolidateFiles(nodes)).toEqual([]);
});

it("releases session controls on native idle even if the compaction end was missed", () => {
  sessionsStore.getState().applySessionPatch("s", {
    nativeTurnActive: true,
    nativeTurnCompacting: true,
    awaitingResponse: true,
    activity: "active",
  });
  sessionsStore.getState().ingestFrame({
    topic: "session.s",
    source: "opencode",
    seq: 1,
    ts: 10,
    raw: { type: "session.status", properties: { sessionID: "root", status: { type: "idle" } } },
  });
  const session = sessionsStore.getState().sessions.s;
  expect(isSessionWorking(session)).toBe(false);
  expect(isSessionBusy(session)).toBe(false);
  expect(session?.nativeTurnCompacting).toBe(false);
  expect(session?.awaitingResponse).toBe(false);
});

it("shows compaction progress and exposes the native summary after completion", () => {
  const event = (status: string, summary: string) => ({
    type: "message.part.updated",
    properties: { part: { type: "compaction", id: "compact", sessionID: "root", status, summary } },
  });
  const started = event("running", "partial");
  const ended = event("completed", "Native summary");
  expect(nativeCompactionActive("opencode", "root", started)).toBe(true);
  expect(nativeCompactionActive("opencode", "other", started)).toBeUndefined();
  expect(nativeCompactionActive("opencode", "root", ended)).toBe(false);
  const nodes = appendTranscriptNodes(
    parseOpenCodeEvent(started, "opencode"),
    parseOpenCodeEvent(ended, "opencode"),
  );
  expect(nodes).toHaveLength(1);
  const view = render(<TranscriptNodeRenderer node={nodes[0]!} />);
  fireEvent.click(view.getByRole("button", { name: "Context compacted" }));
  expect(view.getByText("Native summary")).toBeTruthy();
});

it("selects available native agents independently from automatic approvals", async () => {
  const transport: CommandTransport = {
    catalog: vi.fn(async () => ({
      commands: [
        { id: "agent:build", name: "Build", description: "", kind: "agent", aliases: [] },
        {
          id: "agent:custom",
          name: "Custom planner",
          description: "Custom profile",
          kind: "agent",
          aliases: [],
        },
      ],
    })),
    invoke: vi.fn(),
    list: vi.fn(),
    cancel: vi.fn(),
  };
  const select = vi
    .spyOn(sessionFeed, "selectAgent")
    .mockResolvedValue({ session_id: "s", agent: "custom" });
  const mode = vi
    .spyOn(sessionFeed, "setMode")
    .mockResolvedValue({ session_id: "s", mode: "auto", outcome: "mid_session_applied" });
  const view = render(<Composer sessionId="s" commands={transport} />);
  fireEvent.click(view.getByRole("button", { name: "OpenCode agents" }));
  fireEvent.click(await view.findByRole("button", { name: /Custom planner/ }));
  await waitFor(() => expect(sessionsStore.getState().sessions.s?.nativeAgent).toBe("custom"));
  expect(select).toHaveBeenCalledWith("s", "custom");
  expect(sessionsStore.getState().sessions.s?.interactionMode).toBe("default");
  fireEvent.click(view.getByRole("button", { name: "OpenCode agents" }));
  fireEvent.click(view.getByRole("switch"));
  await waitFor(() => expect(mode).toHaveBeenCalledWith("s", "auto"));
  await act(async () => {});
  expect(sessionsStore.getState().sessions.s?.nativeAgent).toBe("custom");
  expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
});
