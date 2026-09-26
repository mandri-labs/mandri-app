import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { parseFrame, parseHistoryLine } from "@/features/transcript/parse";
import { normalizeTurnEvent } from "@/features/transcript/turns/normalize";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { NativeQuestions } from "@/features/approvals/NativeQuestions";
import { classifyKind } from "@/stores/approvals";
import { nativeSessionUiStore, ingestNativeSessionUi } from "@/stores/nativeSessionUi";
import { sessionsStore } from "@/stores/sessions";
import { NativeSessionExtras } from "@/features/transcript/NativeSessionExtras";
import type { ParseContext } from "@/features/transcript/parse";
import type { ApprovalAnswerParams, EventMessage } from "@/daemon/types/ws";

beforeAll(() => initI18n("en"));
afterEach(() => { cleanup(); nativeSessionUiStore.setState({ sessions: {} }); });

describe("Pi native transcript", () => {
  it("reconstructs delta-only RPC text, reasoning and tool calls and reconciles authoritative completion", () => {
    const context: ParseContext = { piStream: {} };
    let nodes = parseFrame("pi", { type: "message_start", message: { role: "assistant", timestamp: 42, content: [] } }, context);
    const update = (assistantMessageEvent: Record<string, unknown>) => {
      nodes = appendTranscriptNodes(nodes, parseFrame("pi", { type: "message_update", assistantMessageEvent }, context));
    };
    update({ type: "thinking_start", contentIndex: 0 });
    update({ type: "thinking_delta", contentIndex: 0, delta: "Look" });
    update({ type: "thinking_end", contentIndex: 0, content: "Look carefully" });
    update({ type: "text_start", contentIndex: 1 });
    update({ type: "text_delta", contentIndex: 1, delta: "Hel" });
    update({ type: "text_delta", contentIndex: 1, delta: "lo" });
    expect(nodes[1]).toMatchObject({ key: "pi:assistant:42:1", text: "Hello", streaming: true });
    update({ type: "text_end", contentIndex: 1, content: "Hello!" });
    update({ type: "toolcall_start", contentIndex: 2, id: "audit-call", toolName: "custom-audit" });
    update({ type: "toolcall_delta", contentIndex: 2, delta: '{"path":"src"}' });
    update({ type: "toolcall_end", contentIndex: 2, toolCall: { type: "toolCall", id: "audit-call", name: "custom-audit", arguments: { path: "src" } } });
    const message = { role: "assistant", timestamp: 42, content: [
      { type: "thinking", thinking: "Look carefully" }, { type: "text", text: "Hello!" },
      { type: "toolCall", id: "audit-call", name: "custom-audit", arguments: { path: "src" } },
    ] };
    nodes = appendTranscriptNodes(nodes, parseFrame("pi", { type: "message_end", message }, context));
    nodes = appendTranscriptNodes(nodes, parseHistoryLine("pi", JSON.stringify({ type: "message", message })));
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ text: "Look carefully", streaming: false });
    expect(nodes[1]).toMatchObject({ text: "Hello!", streaming: false });
    expect(nodes[2]).toMatchObject({ key: "pi:tool:audit-call", details: { input: { path: "src" } } });
    expect(context.piStream?.message).toBeUndefined();
  });

  it("replaces the conversation on a native branch switch and ignores an old in-flight history page", async () => {
    const sessionId = "branch-switch";
    let resolveOld!: (value: { entries: string[]; has_more: boolean; next_cursor: null }) => void;
    let requests = 0;
    const stored = (text: string, timestamp: number) => JSON.stringify({ type: "message", message: { role: "assistant", timestamp, content: [{ type: "text", text }], stopReason: "stop" } });
    const feed = new SessionFeedService({ getSocket: () => null, fetchHistoryPage: () => ++requests === 1
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ entries: [stored("New branch", 2)], has_more: false, next_cursor: null }) });
    sessionsStore.setState((state) => ({ sessions: { ...state.sessions,
      [sessionId]: { id: sessionId, harness: "pi", title: "Branch", state: "live", deleted: false, pendingApprovals: 0 } } }));
    feed.ensureSession(sessionId, "pi");
    const pending = feed.loadHistory(sessionId);
    feed.ingestSessionFrame(sessionId, "pi", { topic: `session.${sessionId}`, seq: 1, ts: 1, source: "pi",
      raw: { type: "message_end", message: { role: "assistant", timestamp: 1, content: [{ type: "text", text: "Old live branch" }] } } });
    feed.ingestSessionFrame(sessionId, "pi", { topic: `session.${sessionId}`, seq: 2, ts: 2, source: "mandri", raw: { type: "history_changed", reset: true } });
    await feed.loadHistory(sessionId);
    resolveOld({ entries: [stored("Old stored branch", 1)], has_more: false, next_cursor: null });
    await pending;
    expect(feed.getNodes(sessionId)).toEqual([expect.objectContaining({ kind: "assistant", text: "New branch" })]);
    feed.closeSession(sessionId);
  });

  it("reconciles streaming snapshots with final messages and persisted JSONL without duplicating text or tools", () => {
    const partial = { role: "assistant", timestamp: 123, content: [{ type: "thinking", thinking: "Check" }, { type: "text", text: "Hel" }] };
    const complete = { ...partial, content: [{ type: "thinking", thinking: "Checked" }, { type: "text", text: "Hello" },
      { type: "toolCall", id: "call", name: "custom-audit", arguments: { path: "src/test.ts" } }] };
    let nodes = appendTranscriptNodes([], parseFrame("pi", { type: "message_update", message: partial }));
    nodes = appendTranscriptNodes(nodes, parseFrame("pi", { type: "message_update", message: complete }));
    nodes = appendTranscriptNodes(nodes, parseFrame("pi", { type: "message_end", message: complete }));
    nodes = appendTranscriptNodes(nodes, parseHistoryLine("pi", JSON.stringify({ type: "message", id: "entry", message: complete })));
    nodes = appendTranscriptNodes(nodes, parseFrame("pi", { type: "tool_execution_end", toolCallId: "call", toolName: "custom-audit", isError: false,
      result: { content: [{ type: "text", text: "Passed" }], details: { extensions: true } } }));
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ kind: "thinking", text: "Checked", streaming: false });
    expect(nodes[1]).toMatchObject({ kind: "assistant", text: "Hello", streaming: false });
    expect(nodes[2]).toMatchObject({ kind: "tool", tool: "custom-audit", status: "done", target: "src/test.ts", detailText: "Passed",
      details: { input: { path: "src/test.ts" }, output: { details: { extensions: true } } } });
  });

  it("keeps user attachments, custom visible messages, extension errors, and unknown event payloads", () => {
    const nodes = parseFrame("pi", { type: "message_end", message: { role: "user", timestamp: 1, content: [
      { type: "text", text: "Inspect" }, { type: "image", mimeType: "image/png", data: "AA==" },
    ] } });
    expect(nodes[0]).toMatchObject({ kind: "user", text: "Inspect", images: [{ source: "data:image/png;base64,AA==" }] });
    expect(parseHistoryLine("pi", JSON.stringify({ type: "custom_message", content: "Plugin message", display: true }))[0])
      .toMatchObject({ kind: "assistant", text: "Plugin message" });
    expect(parseFrame("pi", { type: "extension_error", error: "Plugin failed" })[0]).toMatchObject({ kind: "system", level: "error", text: "Plugin failed" });
    expect(parseFrame("pi", { type: "future-plugin-event", data: "retained" })[0]).toMatchObject({ kind: "raw", payload: { data: "retained" } });
  });

  it("recognizes live settlement and terminal history without ending a tool-use turn early", () => {
    expect(normalizeTurnEvent("pi", { type: "agent_start" }, { key: "start" })).toMatchObject({ active: true });
    expect(normalizeTurnEvent("pi", { type: "agent_end", willRetry: true }, { key: "retry" })).toMatchObject({ phase: "content", active: true });
    expect(normalizeTurnEvent("pi", { type: "agent_end", willRetry: false, messages: [{ role: "assistant", stopReason: "aborted" }] }, { key: "queued" })).toMatchObject({ phase: "finish", active: true, outcome: "stopped" });
    expect(normalizeTurnEvent("pi", { type: "agent_settled" }, { key: "done" })).toMatchObject({ phase: "finish", active: false });
    expect(normalizeTurnEvent("pi", { type: "message", message: { role: "assistant", timestamp: 123, stopReason: "toolUse" } }, { key: "tool", history: true }))
      .toMatchObject({ phase: "activity", active: true });
    expect(normalizeTurnEvent("pi", { type: "message", message: { role: "assistant", timestamp: 124, stopReason: "aborted" } }, { key: "done", history: true }))
      .toMatchObject({ phase: "finish", outcome: "stopped" });
  });
});

describe("native extension UI", () => {
  it("keeps both native confirm title and message and sends the shared acceptance decision", () => {
    let received: string | undefined;
    render(<ApprovalCard approval={{ approvalId: "confirm-id", sessionId: "pi-confirm", harness: "pi", kind: "permission_scope",
      raw: { type: "extension_ui_request", id: "confirm-id", method: "confirm", title: "Reset audit results", message: "Clear the current report?" },
      deadline: Date.now() + 60_000, status: "pending" }} onAnswer={(decision) => { received = decision; }} />);
    expect(screen.getByText("Reset audit results")).toBeTruthy();
    expect(screen.getByText("Clear the current report?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(received).toBe("accept");
  });

  it("submits a Pi select dialog with its native identifier", () => {
    const raw = { type: "extension_ui_request", id: "select-id", method: "select", title: "Environment", options: ["staging", "production"] };
    let received: ApprovalAnswerParams["answers"];
    render(<NativeQuestions harness="pi" raw={raw} disabled={false} onAnswer={(answers) => { received = answers; }} />);
    fireEvent.click(screen.getByLabelText("staging"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(received).toEqual([{ question: "select-id", answers: ["staging"] }]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(classifyKind("pi", raw)).toBe("user_input");
    expect(classifyKind("pi", { ...raw, method: "confirm" })).toBe("permission_scope");
  });

  it("preserves editor prefill and whitespace in the submitted native response", () => {
    let received: ApprovalAnswerParams["answers"];
    render(<NativeQuestions harness="pi" raw={{ type: "extension_ui_request", id: "edit-id", method: "editor", title: "Patch", prefill: "  original\n" }}
      disabled={false} onAnswer={(answers) => { received = answers; }} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("  original\n");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(received).toEqual([{ question: "edit-id", answers: ["  updated\n"] }]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(received).toEqual([{ question: "edit-id", answers: [""] }]);
  });

  it("updates and clears widgets and status independently and applies native editor text", () => {
    let seq = 0;
    const send = (raw: Record<string, unknown>) => ingestNativeSessionUi({ topic: "session.pi-test", source: "pi", seq: ++seq, ts: 1,
      raw: { type: "extension_ui_request", ...raw } } as EventMessage);
    send({ method: "setStatus", statusKey: "tokens", statusText: "\u001b[32m42 tokens\u001b[0m" });
    send({ method: "setWidget", widgetKey: "checks", widgetLines: ["Audit", "Passed"], widgetPlacement: "aboveEditor" });
    render(<><NativeSessionExtras sessionId="pi-test" placement="aboveEditor" /><NativeSessionExtras sessionId="pi-test" placement="belowEditor" /></>);
    expect(screen.getByText("42 tokens")).toBeTruthy();
    expect(screen.getByText(/Audit/)).toBeTruthy();
    send({ method: "set_editor_text", text: "/custom follow-up" });
    expect(sessionsStore.getState().drafts["pi-test"]).toBe("/custom follow-up");
    sessionsStore.getState().setDraft("pi-test", "User edited the draft");
    ingestNativeSessionUi({ topic: "session.pi-test", source: "pi", seq, ts: 1,
      raw: { type: "extension_ui_request", method: "set_editor_text", text: "/custom follow-up" } } as EventMessage);
    expect(sessionsStore.getState().drafts["pi-test"]).toBe("User edited the draft");
    send({ method: "setWidget", widgetKey: "checks" });
    send({ method: "setStatus", statusKey: "tokens" });
    expect(nativeSessionUiStore.getState().sessions["pi-test"]).toEqual({ statuses: {}, widgets: {} });
  });
});
