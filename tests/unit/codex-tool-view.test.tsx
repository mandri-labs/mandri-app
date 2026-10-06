import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { CodexTool } from "@/features/transcript/renderers/CodexTool";
import { codexResultSections, codexToolTitle } from "@/features/transcript/parse/codexToolView";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";
import type { TranscriptNode } from "@/features/transcript/parse/types";
import { agentsStore } from "@/stores/agents";

beforeAll(() => initI18n("en"));
afterEach(cleanup);
const fixture = [
  { type: "input_text", text: "Script completed\nWall time 1.6 seconds\nOutput:\n" },
  {
    type: "input_text",
    text: JSON.stringify({
      chunk_id: "a",
      exit_code: 0,
      wall_time_seconds: 1.1,
      output: 'C:\\new\\test.py\r\nprint("hello")',
    }),
  },
];
const tool = (nodes: TranscriptNode[]) => {
  const node = nodes[0];
  if (node?.kind !== "tool") throw new Error("Expected tool");
  return node;
};

describe("structured Codex tools", () => {
  it("resolves task paths within the current family and retains both names", () => {
    const base = {
      native_id: "native",
      parent_agent_id: null,
      session_id: null,
      harness: "codex" as const,
      state: "completed" as const,
      delegation_id: null,
      capabilities: { message: false, stop: false },
      created_at: 0,
      updated_at: 0,
      task_id: "/root/review",
    };
    agentsStore.setState({
      agents: {
        wrong: { ...base, id: "wrong", parent_session_id: "other", title: "Wrong" },
        right: { ...base, id: "right", parent_session_id: "parent", title: "Cicero" },
      },
    });
    try {
      render(
        <CodexTool
          sessionId="parent"
          node={{
            kind: "tool",
            tool: "send_message",
            label: "",
            status: "done",
            codex: { input: { target: "review", message: "gAAAAABhidden" } },
          }}
        />,
      );
      expect(screen.getByText("Cicero (review) : update completed")).toBeTruthy();
      expect(screen.queryByText(/Wrong|gAAAAABhidden/)).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    } finally {
      agentsStore.setState({ agents: {} });
    }
  });
  it("renders recorded questions, choices and answers as readable conversation content", () => {
    render(
      <CodexTool
        node={{
          kind: "tool",
          tool: "functions.request_user_input",
          label: "Question",
          status: "done",
          codex: {
            input: {
              questions: [
                {
                  id: "mode",
                  question: "Which mode?",
                  options: [{ label: "Fast", description: "Quick feedback" }],
                },
              ],
            },
            output: { answers: { mode: { answers: ["Fast"] } } },
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Which mode?" }));
    expect(document.querySelector(".tr-codex-question")?.textContent).toBe("Which mode?");
    expect(document.querySelector(".tr-codex-answer")?.textContent).toContain("Answer: Fast");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shows a non-expandable agent activity without exposing its instruction", () => {
    render(
      <CodexTool
        node={{
          kind: "tool",
          tool: "collaboration.spawn_agent",
          label: "Delegate",
          status: "done",
          codex: {
            input: { task_name: "review", message: "Check the accessibility of this view." },
            output: { agent_id: "agent-1" },
          },
        }}
      />,
    );
    expect(screen.getByText("review : agent created")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.queryByText("Check the accessibility of this view.")).toBeNull();
  });
  it("unwraps the actual nested input_text format without transport leakage", () => {
    expect(codexResultSections(fixture)).toEqual([
      { text: 'C:\\new\\test.py\r\nprint("hello")', exitCode: 0, durationMs: 1100 },
    ]);
    expect(codexResultSections("literal \\n C:\\new")).toEqual([{ text: "literal \\n C:\\new" }]);
    expect(codexToolTitle("exec", 'text(await tools.exec_command({cmd: "git status"}));')).toBe(
      "git status",
    );
    expect(codexToolTitle("exec", "await tools.exec_command({cmd: dynamic})")).toBe("exec");
  });

  it("retains the input and open disclosure as history results update", () => {
    const parse = (payload: object) =>
      parseCodexHistoryLine(JSON.stringify({ type: "response_item", payload }), "codex");
    let nodes = parse({
      type: "custom_tool_call",
      name: "exec",
      call_id: "c1",
      input: 'await tools.exec_command({cmd: "git status"})',
    });
    const view = render(<CodexTool node={tool(nodes)} />);
    fireEvent.click(screen.getByRole("button", { name: "git status" }));
    nodes = appendTranscriptNodes(
      nodes,
      parse({ type: "custom_tool_call_output", call_id: "c1", output: fixture }),
    );
    view.rerender(<CodexTool node={tool(nodes)} />);
    expect(screen.getByRole("button", { name: "git status" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(view.container.textContent).toContain('print("hello")');
    expect(view.container.textContent).not.toContain("chunk_id");
    expect(view.container.textContent).not.toContain("input_text");
    expect(nodes).toHaveLength(1);
  });

  it("appends realtime output and replaces it with the completed snapshot", () => {
    const parse = (method: string, params: object) => parseCodexEvent({ method, params }, "codex");
    let nodes = parse("item/started", {
      item: { id: "c1", type: "commandExecution", command: "git status" },
    });
    for (const delta of ["fir", "st\n"])
      nodes = appendTranscriptNodes(
        nodes,
        parse("item/commandExecution/outputDelta", { itemId: "c1", delta }),
      );
    expect(tool(nodes).codex?.output).toBe("first\n");
    nodes = appendTranscriptNodes(
      nodes,
      parse("item/completed", {
        item: {
          id: "c1",
          type: "commandExecution",
          command: "git status",
          aggregatedOutput: "first\nsecond",
          exitCode: 1,
        },
      }),
    );
    expect(nodes).toHaveLength(1);
    expect(tool(nodes)).toMatchObject({ status: "failed", codex: { output: "first\nsecond" } });
  });
});
