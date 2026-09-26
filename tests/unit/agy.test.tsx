import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createAgyHistoryContext, parseFrame, parseHistoryLine } from "@/features/transcript/parse";
import { appendTranscriptNodes, mergeHistoryAndLive } from "@/daemon/ws/transcriptMerge";
import { presentTranscript } from "@/features/transcript/presentation";
import { nativeTurnActivity } from "@/features/transcript/turnActivity";
import { modelSelection } from "@/daemon/modelSelection";
import { classifyKind, HARNESS_VARIANTS } from "@/stores/approvals";
import { AgyQuestions } from "@/features/approvals/AgyQuestions";
import { extractApprovalContext } from "@/features/approvals/ApprovalCard";
import type { ApprovalAnswerParams } from "@/daemon/types/ws";
import { parseRuntimeCapabilities } from "@/daemon/runtimeCapabilities";
import { PermissionMenu } from "@/features/sessions/PermissionMenu";

import nativeTools from "./fixtures/agy-native-tools.json";
import { TranscriptNodeRenderer } from "@/features/transcript/renderers/TranscriptNodeRenderer";

const context = { sessionId: "session" };
const step = (step_index: number, fields: Record<string, unknown>) => ({ event: "step_update", step_update: { conversation_id: "native", step_index, ...fields } });

describe("Antigravity", () => {
  it("uses advertised runtime modes and tolerates absent capabilities", () => {
    expect(parseRuntimeCapabilities(null)).toBeUndefined();
    const capabilities = parseRuntimeCapabilities({ model_sources: ["native", "gateway"], permission_modes: ["plan"], steering: "stop_resume", input_types: ["text"] });
    expect(capabilities).toMatchObject({ modelSources: ["native", "gateway"], steering: "stop_resume", inputTypes: ["text"] });
    const view = render(<PermissionMenu harness="agy" selected="plan" modes={capabilities?.permissionModes} onSelect={() => undefined} />);
    expect(view.getAllByRole("button")).toHaveLength(1);
    view.unmount();
  });

  it("appends the final delta and reconciles native history without duplicate text", () => {
    let live = parseFrame("agy", step(1, { step_type: "agent_response", state: "ACTIVE", text_delta: "hel" }), context);
    live = appendTranscriptNodes(live, parseFrame("agy", step(1, { step_type: "agent_response", state: "DONE", text_delta: "lo" }), context));
    expect(live).toMatchObject([{ kind: "assistant", text: "hello", streaming: false }]);
    const history = parseHistoryLine("agy", JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", content: "hello" }), context);
    expect(mergeHistoryAndLive(history, live)).toHaveLength(1);
    const complete = parseFrame("agy", step(1, { step_type: "agent_response", state: "DONE" }), context);
    expect(appendTranscriptNodes(live, complete)).toMatchObject([{ text: "hello", streaming: false }]);
  });

  it("unwraps only native user metadata", () => {
    expect(parseHistoryLine("agy", JSON.stringify({ step_index: 0, type: "USER_INPUT", content: "<USER_REQUEST>\nHello\n</USER_REQUEST>\n<ADDITIONAL_METADATA>local time</ADDITIONAL_METADATA>" }), context)).toMatchObject([{ kind: "user", text: "Hello" }]);
    expect(parseFrame("agy", step(0, { step_type: "user_input", text_delta: "keep <tag>" }), context)).toMatchObject([{ text: "keep <tag>" }]);
  });

  it("keeps command arguments across sparse completion and renders failures", () => {
    const first = parseFrame("agy", { event: "hook", hook: "PreToolUse", data: { stepIdx: 2, toolCall: { name: "run_command", args: { CommandLine: "echo synthetic" } } } }, context);
    const done = parseFrame("agy", step(2, { step_type: "tool", state: "DONE", tool_name: "run_command", tool_info: { error: "Denied" } }), context);
    expect(appendTranscriptNodes(first, done)).toMatchObject([{ kind: "tool", target: "echo synthetic", status: "failed", detailText: "Denied", details: { input: { CommandLine: "echo synthetic" } } }]);
  });

  it("renders complete native system wrappers as notices without changing their text", () => {
    const notice = "\nAll your subagents and background tasks have been stopped due to server restart.\n";
    const wrapped = `<SYSTEM_MESSAGE>${notice}</SYSTEM_MESSAGE>`;
    const live = parseFrame("agy", step(3, { step_type: "user_input", text_delta: wrapped }), context);
    const history = parseHistoryLine("agy", JSON.stringify({ step_index: 3, type: "USER_INPUT", source: "SYSTEM", content: wrapped }), context);
    expect(live).toEqual([{ kind: "system", key: "agy:session:3", level: "info", text: notice }]);
    expect(history).toEqual(live);
    expect(mergeHistoryAndLive(history, live)).toHaveLength(1);
    for (const text of [`Quote: ${wrapped}`, `${wrapped} trailing`, "<SYSTEM_MESSAGE>unfinished", `<USER_REQUEST>${wrapped}</USER_REQUEST>`, `${wrapped}${wrapped}`]) {
      expect(parseFrame("agy", step(3, { step_type: "user_input", text_delta: text }), context)[0]).toMatchObject({ kind: "user" });
    }
    expect(parseHistoryLine("agy", JSON.stringify({ type: "USER_INPUT", source: "SYSTEM", content: "ordinary text" }))[0]).toMatchObject({ kind: "user", text: "ordinary text" });
  });

  it("hides native system envelopes in live events and reloaded history", () => {
    const content = "[Notice] Background tasks stopped after restart.";
    const envelope = `<SYSTEM_MESSAGE>\n${content}\n</SYSTEM_MESSAGE>`;
    const preamble = "The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n";
    for (const text of [envelope, preamble + envelope, content, `Quoted: ${envelope}`]) {
      const expected = text.startsWith("Quoted:") ? text : content;
      const live = parseFrame("agy", step(3, { step_type: "system_message", text, state: "DONE" }), context);
      const history = parseHistoryLine("agy", JSON.stringify({ step_index: 3, type: "SYSTEM_MESSAGE", source: "SYSTEM", content: text }), context);
      expect(live).toMatchObject([{ kind: "system", text: expected }]);
      expect(history).toEqual(live);
    }
  });

  it("ignores empty progress placeholders without overwriting history or hiding unfamiliar data", () => {
    for (const step_type of ["user_input", "system_message"]) {
      for (const state of ["ACTIVE", "DONE"]) {
        expect(parseFrame("agy", step(7, { step_type, state, duration_seconds: 0.002346733 }), context)).toEqual([]);
      }
      const unfamiliar = step(7, { step_type, state: "DONE", attachment: { uri: "synthetic://asset" } });
      expect(parseFrame("agy", unfamiliar, context)).toMatchObject([{ kind: "raw", payload: unfamiliar }]);
    }
    const history = parseHistoryLine("agy", JSON.stringify({ step_index: 7, type: "USER_INPUT", content: "Keep this prompt" }), context);
    const placeholder = parseFrame("agy", step(7, { step_type: "user_input", state: "DONE" }), context);
    expect(appendTranscriptNodes(history, placeholder)).toEqual(history);
    const notice = parseFrame("agy", step(8, { step_type: "system_message", text_delta: "Keep this notice\n", state: "ACTIVE" }), context);
    expect(appendTranscriptNodes(notice, parseFrame("agy", step(8, { step_type: "system_message", state: "DONE" }), context))).toEqual(notice);
    expect(parseFrame("agy", step(9, { step_type: "system_message", state: "ERROR" }), context)).toMatchObject([{ kind: "system", level: "error" }]);
  });

  it("reconciles native planner batches with real tool step identities and expandable output", () => {
    const lines = nativeTools.history.map((record) => JSON.stringify(record));
    const historyContext = { ...context, ...createAgyHistoryContext(lines) };
    const history = lines.flatMap((line) => parseHistoryLine("agy", line, historyContext));
    const live = nativeTools.live.reduce((nodes, event) => appendTranscriptNodes(nodes, parseFrame("agy", event, context)), [] as ReturnType<typeof parseFrame>);
    const visibleTool = (node: (typeof history)[number]) => node.kind === "tool" ? { key: node.key, tool: node.tool, title: node.title, status: node.status, target: node.target, actions: node.actions, details: node.details } : node;
    expect(history.filter((node) => node.kind === "tool").map(visibleTool)).toEqual(live.filter((node) => node.kind === "tool").map(visibleTool));
    expect(history).toHaveLength(3);
    expect(mergeHistoryAndLive(history, live)).toHaveLength(3);
    const view = render(<TranscriptNodeRenderer node={history[0]!} />);
    expect(view.queryByText("first")).toBeNull();
    fireEvent.click(view.getByRole("button"));
    expect(view.getByText("first")).toBeTruthy();
    view.unmount();
  });

  it("preserves uncorrelated history without guessing a command across missing steps", () => {
    const records = [nativeTools.history[0]!, nativeTools.history[2]!];
    const lines = records.map((record) => JSON.stringify(record));
    const historyContext = { ...context, ...createAgyHistoryContext(lines) };
    expect(historyContext.agyToolCalls?.size).toBe(0);
    expect(parseHistoryLine("agy", lines[0]!, historyContext)[0]).toMatchObject({ kind: "raw" });
    expect(parseHistoryLine("agy", lines[1]!, historyContext)[0]).toMatchObject({ kind: "tool", tool: "tool_result", detailText: "second\n" });
  });

  it("removes recognized settings suffixes but preserves quoted or malformed wrappers", () => {
    const wrapped = "<USER_REQUEST>\nActual prompt\n</USER_REQUEST>\n<ADDITIONAL_METADATA>time</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>model setting</USER_SETTINGS_CHANGE>";
    expect(parseHistoryLine("agy", JSON.stringify({ type: "USER_INPUT", content: wrapped }))[0]).toMatchObject({ kind: "user", text: "Actual prompt" });
    for (const text of [`Quote ${wrapped}`, `${wrapped} trailing text`, "<USER_REQUEST>quoted <USER_REQUEST>inner</USER_REQUEST></USER_REQUEST>"]) {
      expect(parseHistoryLine("agy", JSON.stringify({ type: "USER_INPUT", content: text }))[0]).toMatchObject({ kind: "user", text });
    }
  });

  it("keeps the actual async live command running until its delayed native completion", () => {
    let nodes: ReturnType<typeof parseFrame> = [];
    for (const event of nativeTools.asyncLive.slice(0, 3)) nodes = appendTranscriptNodes(nodes, parseFrame("agy", event, context));
    expect(nodes.filter((node) => node.kind === "tool")).toMatchObject([{ key: "agy:session:2", status: "running", target: "sleep 4; echo delayed" }]);
    for (const event of nativeTools.asyncLive.slice(3)) nodes = appendTranscriptNodes(nodes, parseFrame("agy", event, context));
    expect(nodes.filter((node) => node.kind === "tool")).toMatchObject([{ key: "agy:session:2", status: "done", detailText: "delayed", target: "sleep 4; echo delayed" }]);
    expect(nodes.filter((node) => node.kind === "tool")).toHaveLength(1);
    expect(nodes.some((node) => node.kind === "system")).toBe(false);
  });

  it("attaches delayed native task output to its explicit task identity", () => {
    const lines = nativeTools.asyncHistory.map((record) => JSON.stringify(record));
    const runningContext = { ...context, ...createAgyHistoryContext(lines.slice(0, 3)) };
    const running = lines.slice(0, 3).flatMap((line) => parseHistoryLine("agy", line, runningContext));
    expect(running[0]).toMatchObject({ kind: "tool", key: "agy:session:2", status: "running" });
    const completeContext = { ...context, ...createAgyHistoryContext(lines) };
    const complete = lines.flatMap((line) => parseHistoryLine("agy", line, completeContext));
    expect(complete).toMatchObject([{ kind: "tool", key: "agy:session:2", status: "done", detailText: "delayed", target: "sleep 4; echo delayed" }, { kind: "assistant" }]);
    const live = parseFrame("agy", step(2, { step_type: "tool", state: "DONE", tool_info: { name: "run_command", parameters: nativeTools.asyncHistory[0]!.tool_calls![0]!.args, output: "delayed" } }), context);
    expect(complete[0]).toMatchObject({ kind: "tool", key: live[0]!.key, status: "done", details: { input: nativeTools.asyncHistory[0]!.tool_calls![0]!.args, output: "delayed" } });
    expect(mergeHistoryAndLive(complete, live)).toHaveLength(2);
    const wrongSender = lines.map((line) => line.replace("sender=synthetic-conversation/task-2", "sender=another-conversation/task-2"));
    expect(createAgyHistoryContext(wrongSender).agyTaskResults?.size).toBe(0);
    const failed = lines.map((line) => line.replace("exited with code 0", "exited with code 7"));
    const failureContext = { ...context, ...createAgyHistoryContext(failed) };
    expect(parseHistoryLine("agy", failed[1]!, failureContext)[0]).toMatchObject({ kind: "tool", status: "failed", detailText: "delayed" });
  });

  it("renders successful native command results without duplicating ordinary final responses", () => {
    const command = { name: "model", data: { id: "example", label: "Example", effort: "high", is_default: true } };
    expect(parseFrame("agy", { event: "result", result: { status: "SUCCESS", conversation_id: "", command, response: "example\tExample\n" }, num_turns: 0 })).toEqual([{ kind: "system", level: "info", text: "example\tExample\n" }]);
    expect(parseFrame("agy", { event: "result", result: { status: "SUCCESS", command } })).toMatchObject([{ kind: "system", text: JSON.stringify(command.data, null, 2) }]);
    expect(parseFrame("agy", { event: "result", result: { status: "SUCCESS", response: "Already streamed" } })).toEqual([]);
  });

  it("shows denied actions even when the CLI reports success", () => {
    const nodes = parseFrame("agy", { event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ display_name: "RunCommand" }] } });
    expect(presentTranscript(nodes)).toMatchObject([{ kind: "system", level: "warning" }]);
  });

  it("displays native response errors and preserves cumulative usage without summing it", () => {
    expect(parseFrame("agy", step(1, { step_type: "agent_response", state: "ERROR", error: "Model unavailable" }))).toMatchObject([{ kind: "system", level: "error", text: "Model unavailable" }]);
    const result = { event: "result", result: { status: "SUCCESS", usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } };
    expect(parseFrame("agy", result)).toMatchObject([{ kind: "system", values: { tokens: 15 } }, { kind: "raw", payload: result }]);
    const zero = { event: "result", result: { status: "SUCCESS", usage: { total_tokens: 0 } } };
    expect(parseFrame("agy", zero)).toEqual([{ kind: "raw", harness: "agy", payload: zero }]);
    expect(parseFrame("agy", { event: "result", result: { status: "SUCCESS" } })).toEqual([]);
  });

  it("preserves unknown data and does not infer idle from result", () => {
    const raw = { event: "future_event", data: { value: 1 } };
    expect(parseFrame("agy", raw)).toMatchObject([{ kind: "raw", payload: raw }]);
    expect(nativeTurnActivity("agy", "native", { event: "result", result: { status: "SUCCESS" } })).toBeUndefined();
    expect(nativeTurnActivity("agy", "native", { event: "hook", hook: "Stop", data: { fullyIdle: false } })).toBe(true);
    expect(nativeTurnActivity("agy", "native", { event: "hook", hook: "Stop", data: { fullyIdle: true } })).toBe(false);
    expect(nativeTurnActivity("agy", "native", { event: "hook", hook: "Stop", data: { conversationId: "child", fullyIdle: true } })).toBeUndefined();
  });

  it("selects native Google models and exposes agy approval choices", () => {
    expect(modelSelection("native:agy/gemini-example")).toEqual({ model: "gemini-example", model_source: "native" });
    expect(HARNESS_VARIANTS.agy.map((value) => value.decision)).toEqual(["allow", "always", "deny"]);
    const raw = { toolCall: { name: "run_command", args: { CommandLine: "echo test" } } };
    expect(classifyKind("agy", raw)).toBe("command_execution");
    expect(extractApprovalContext({ approvalId: "a", sessionId: "s", harness: "agy", kind: "command_execution", raw, deadline: 0, status: "pending" })).toMatchObject({ command: "echo test" });
  });

  it("sends structured answers for native questions", () => {
    let result: ApprovalAnswerParams["answers"];
    render(<AgyQuestions raw={{ toolCall: { name: "ask_question", args: { questions: [{ question: "Choose", options: ["One", "Two"], is_multi_select: true }] } } }} disabled={false} onAnswer={(answers) => { result = answers; }} />);
    fireEvent.click(screen.getByLabelText("One"));
    fireEvent.click(screen.getByLabelText("Two"));
    fireEvent.submit(screen.getByRole("button").closest("form")!);
    expect(result).toEqual([{ question: "Choose", answers: ["One", "Two"] }]);
  });
});
