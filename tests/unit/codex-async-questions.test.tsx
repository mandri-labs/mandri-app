import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { Composer } from "@/features/transcript/Composer";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { DaemonError } from "@/daemon/errors";
import { initI18n } from "@/i18n";

const questions = [
  { title: "Which title?", options: ["Summary", "Current action"] },
  { title: "Any details?" },
];
const item = { type: "agentMessage", id: "question-call", delivery: "async", questions,
  text: "Which title?\n- Summary\n- Current action\n\nAny details?" };
const event = { method: "item/completed", params: { item } };
const history = [
  { type: "response_item", payload: { type: "function_call", name: "request_user_input_async",
    call_id: item.id, arguments: JSON.stringify({ questions }) } },
  { type: "event_msg", payload: { type: "item_completed", item: { ...item, type: "AgentMessage",
    text: undefined, content: [{ type: "Text", text: item.text }] } } },
  { type: "response_item", payload: { type: "function_call_output", call_id: item.id,
    output: '{"accepted":true}' } },
].map((entry) => JSON.stringify(entry));

beforeAll(async () => { await initI18n("en"); });
beforeEach(() => {
  transcriptStore.getState().resetTranscripts();
  sessionsStore.setState({ sessions: { s1: { id: "s1", harness: "codex", state: "live",
    title: "Session", deleted: false, pendingApprovals: 0 } }, drafts: {}, order: ["s1"] });
});
afterEach(cleanup);

it("restores the same interactive question from live events and complete native history", async () => {
  const live = parseCodexEvent(event, "codex");
  const restored = history.reduce((nodes, line) => appendTranscriptNodes(nodes, parseCodexHistoryLine(line, "codex")), [] as typeof live);
  expect(restored).toEqual(live);
  expect(restored).toMatchObject([{ kind: "assistant", key: item.id,
    questions: [{ title: "Which title?", options: ["Summary", "Current action"] }, { title: "Any details?", options: [] }] }]);
  const feed = new SessionFeedService({ getSocket: () => null, fetchHistoryPage: async () => ({
    entries: history, next_cursor: null, has_more: false,
  }) });
  feed.ensureSession("s1", "codex");
  feed.ingestSessionFrame("s1", "codex", { topic: "session.s1", seq: 1, ts: 1, source: "codex", raw: event });
  await feed.loadHistory("s1");
  await feed.loadHistory("s1", { refresh: true });
  expect(feed.getNodes("s1")).toHaveLength(1);
  expect(feed.getNodes("s1")).toMatchObject(live);
});

it("keeps malformed questions as ordinary text and ignores unrelated message metadata", () => {
  expect(parseCodexEvent({ ...event, params: { item: { ...item, questions: [null, { title: 5 }] } } }, "codex"))
    .toEqual([{ kind: "assistant", key: item.id, text: item.text }]);
  expect(parseCodexEvent({ ...event, params: { item: { ...item, delivery: undefined } } }, "codex"))
    .toEqual([{ kind: "assistant", key: item.id, text: item.text }]);
});

function showQuestion() {
  transcriptStore.getState().setNodes("s1", parseCodexEvent(event, "codex"));
}

it("sends explicitly selected and free answers through the composer with the existing draft", async () => {
  showQuestion();
  sessionsStore.getState().setDraft("s1", "Keep this detail");
  const sendPrompt = vi.fn().mockResolvedValue({ state: "queued", code: null });
  render(<Composer sessionId="s1" feed={{ sendPrompt, interrupt: vi.fn() }} />);
  const submit = screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement;
  expect(submit.closest(".composer")).toBeNull();
  expect(submit.closest(".approval-card")).not.toBeNull();
  expect(screen.queryByRole("textbox", { name: "Free answer 1" })).toBeNull();
  expect(submit.disabled).toBe(true);
  expect((screen.getByRole("radio", { name: "Summary" }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: "Summary" }));
  expect(sendPrompt).not.toHaveBeenCalled();
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Free answer 2" }), { target: { value: "No animation" } });
  fireEvent.click(submit);
  await waitFor(() => expect(sendPrompt).toHaveBeenCalledExactlyOnceWith("s1",
    "Which title?\nSummary\n\nAny details?\nNo animation\n\nKeep this detail"));
  expect(screen.queryByRole("button", { name: "Send answer" })).toBeNull();
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(1);
});

it.each(["service_unavailable", "delivery_unknown"] as const)("preserves delivery handling for %s", async (code) => {
  showQuestion();
  const sendPrompt = vi.fn().mockRejectedValue(new DaemonError({ code, message: "offline" }));
  render(<Composer sessionId="s1" feed={{ sendPrompt, interrupt: vi.fn() }} />);
  fireEvent.click(screen.getByRole("radio", { name: "Another answer" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Free answer 1" }), { target: { value: "Custom title" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Free answer 2" }), { target: { value: "Details" } });
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await screen.findByRole("alert");
  expect(sendPrompt).toHaveBeenCalledTimes(1);
  if (code === "delivery_unknown") {
    expect(screen.queryByRole("button", { name: "Send answer" })).toBeNull();
    expect(sessionsStore.getState().drafts.s1).toBe("");
  } else {
    expect(sessionsStore.getState().drafts.s1).toBe("Which title?\nCustom title\n\nAny details?\nDetails");
    expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();
  }
});

it("removes an old question after a user message and isolates sessions", () => {
  showQuestion();
  const view = render(<Composer sessionId="s1" />);
  expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();
  view.rerender(<Composer sessionId="other" />);
  expect(screen.queryByRole("button", { name: "Send answer" })).toBeNull();
  view.rerender(<Composer sessionId="s1" />);
  act(() => transcriptStore.getState().setNodes("s1", [...parseCodexEvent(event, "codex"),
    { kind: "user", text: "Use the summary", key: "reply" }]));
  expect(screen.queryByRole("button", { name: "Send answer" })).toBeNull();
});

it("applies the same availability restrictions to answers as to normal messages", () => {
  showQuestion();
  sessionsStore.getState().applySessionPatch("s1", { state: "stopped" });
  const sendPrompt = vi.fn();
  render(<Composer sessionId="s1" feed={{ sendPrompt, interrupt: vi.fn() }} />);
  expect((screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("radio", { name: "Summary" }).closest("fieldset")?.disabled).toBe(true);
  expect(sendPrompt).not.toHaveBeenCalled();
});
