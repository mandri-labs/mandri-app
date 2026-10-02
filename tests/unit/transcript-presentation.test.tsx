import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";
import { parseClaudeHistoryLine } from "@/features/transcript/parse/claude";
import { parseOpenCodeEvent } from "@/features/transcript/parse/opencode";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";
import { presentTranscript } from "@/features/transcript/presentation";
import { MarkdownText } from "@/features/transcript/renderers/MarkdownText";

afterEach(cleanup);

describe("conversation presentation regressions", () => {
  it("retains completed Markdown elements when text streams below them", () => {
    const text = "# Heading\n\n```js\nconst value = 1;\n```\n\n| A | B |\n| - | - |\n| one | two |\n\n[Reference](https://example.com)";
    const view = render(<MarkdownText text={text} />);
    const elements = ["h1", "pre", "table", "a"].map((selector) => view.container.querySelector(selector));
    expect(elements.every(Boolean)).toBe(true);
    for (let i = 1; i <= 3; i++) {
      view.rerender(<MarkdownText text={text + "\n\nMore text.".repeat(i)} />);
      ["h1", "pre", "table", "a"].forEach((selector, index) => {
        expect(view.container.querySelector(selector)).toBe(elements[index]);
      });
    }
  });
  it("joins Claude history across pages without losing the result or failed state", () => {
    const call = parseClaudeHistoryLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "call", name: "Bash", input: { command: "git --version" } },
          ],
        },
      }),
      "claude",
    );
    const result = parseClaudeHistoryLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "call", is_error: true, content: "Denied by user" },
          ],
        },
      }),
      "claude",
    );
    const merged = appendTranscriptNodes([], [...call, ...result]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      tool: "Bash",
      status: "failed",
      target: "git --version",
      detailText: "Denied by user",
    });
  });

  it("uses the Codex call_id rather than the distinct item id to recover output", () => {
    const parse = (payload: object) =>
      parseCodexHistoryLine(JSON.stringify({ type: "response_item", payload }), "codex");
    const call = parse({
      type: "function_call",
      id: "item-1",
      call_id: "call-1",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "git --version" }),
    });
    const output = parse({
      type: "function_call_output",
      id: "item-2",
      call_id: "call-1",
      output: "git version 2.49",
    });
    const merged = appendTranscriptNodes([], [...call, ...output]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      target: "git --version",
      detailText: "git version 2.49",
      status: "done",
    });
    expect(
      parseCodexEvent(
        {
          method: "item/completed",
          params: {
            item: {
              type: "commandExecution",
              id: "call-1",
              command: "git --version",
              exitCode: 0,
              aggregatedOutput: "git version 2.49",
            },
          },
        },
        "codex",
      )[0],
    ).toMatchObject({ target: "git --version", detailText: "git version 2.49", status: "done" });
  });

  it("keeps OpenCode error output inspectable", () => {
    expect(
      parseOpenCodeEvent(
        {
          type: "message.part.updated",
          properties: {
            part: {
              type: "tool",
              id: "part",
              tool: "bash",
              state: { status: "error", input: { command: "false" }, error: "Exit 1" },
            },
          },
        },
        "opencode",
      )[0],
    ).toMatchObject({ status: "failed", detailText: "Exit 1" });
  });

  it("never classifies a user's pasted instructions as injected context", () => {
    const text =
      "<INSTRUCTIONS>AGENTS.md</INSTRUCTIONS><environment_context>hello</environment_context>";
    const parsed = parseCodexHistoryLine(
      JSON.stringify({
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ text }] },
      }),
      "codex",
    );
    expect(presentTranscript(parsed)[0]).toMatchObject({ kind: "user", text });
  });

  it("renders GFM and keeps HTML and unsafe links inert", () => {
    const html = renderToStaticMarkup(
      <MarkdownText
        text={
          "**Result**\n\n- [x] Tested\n\n`code`\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))"
        }
      />,
    );
    expect(html).toContain("<strong>Result</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });
});
