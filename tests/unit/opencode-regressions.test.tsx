import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { parseOpenCodeEvent, parseOpenCodeHistoryLine } from "@/features/transcript/parse/opencode";
import { TranscriptNodeRenderer } from "@/features/transcript/renderers/TranscriptNodeRenderer";
import { appendTranscriptNodes } from "@/daemon/ws/transcriptMerge";
import { Composer } from "@/features/transcript/Composer";
import { isSessionBusy } from "@/features/transcript/turnActivity";
import { dispatchFrame } from "@/app/framePipeline";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { approvalsStore, setApprovalTransport } from "@/stores/approvals";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { initI18n } from "@/i18n";
import type { ApprovalPendingMessage, EventMessage } from "@/daemon/types/ws";

beforeAll(() => initI18n("en"));
beforeEach(() => {
  approvalsStore.getState().reset();
  sessionsStore.setState({
    sessions: {
      s: {
        id: "s",
        harness: "opencode",
        nativeId: "root",
        state: "live",
        title: "Session",
        deleted: false,
        pendingApprovals: 0,
      },
    },
  });
});
afterEach(() => {
  cleanup();
  sessionFeed.closeSession("s");
  transcriptStore.getState().removeTranscript("s");
  setApprovalTransport(null);
});

const todoEvent = (
  status = "completed",
  todos: unknown = [
    { content: "Read instructions", status: "completed", priority: "high" },
    { content: "Run checks", status: "in_progress", priority: "high" },
    { content: "Create commits", status: "pending", priority: "high" },
    { content: "Push", status: "cancelled", priority: "low" },
  ],
) => ({
  type: "message.part.updated",
  properties: {
    part: {
      type: "tool",
      id: "part",
      callID: "todo",
      sessionID: "root",
      tool: "todowrite",
      state: { status, input: { todos }, output: JSON.stringify(todos) },
    },
  },
});

it("renders native todos as steps through live updates and stored history", () => {
  const pending = parseOpenCodeEvent(todoEvent("running"), "opencode");
  const completed = parseOpenCodeEvent(todoEvent(), "opencode");
  const nodes = appendTranscriptNodes(pending, completed);
  expect(nodes).toHaveLength(1);
  expect(nodes).toEqual(parseOpenCodeHistoryLine(JSON.stringify(todoEvent()), "opencode"));
  const view = render(<TranscriptNodeRenderer node={nodes[0]!} />);
  expect(view.container.querySelectorAll(".tr-plan-step")).toHaveLength(4);
  expect(view.container.querySelector(".tr-plan-step-running")?.textContent).toBe("Run checks");
  expect(view.container.querySelector(".tr-plan-step-cancelled")?.textContent).toBe("Push");
  expect(view.container.querySelector(".tr-tool")).toBeNull();
  expect(view.container.textContent).not.toContain("priority");
});

it("preserves invalid and failed todo calls for inspection", () => {
  expect(
    parseOpenCodeEvent(
      todoEvent("completed", [{ content: "Invalid", status: "bogus" }]),
      "opencode",
    )[0]?.kind,
  ).toBe("tool");
  expect(parseOpenCodeEvent(todoEvent("error"), "opencode")[0]).toMatchObject({
    kind: "tool",
    status: "failed",
  });
});

let seq = 0;
function native(raw: unknown): void {
  const frame: EventMessage = {
    topic: "session.s",
    seq: ++seq,
    ts: 1000 + seq,
    source: "opencode",
    raw,
  };
  sessionsStore.getState().ingestFrame(frame);
}
const finish = (owner = "root", reason = "stop") => ({
  type: "message.updated",
  properties: {
    info: {
      id: "assistant",
      parentID: "user",
      sessionID: owner,
      role: "assistant",
      time: { created: 1000, completed: 2000 },
      finish: reason,
    },
  },
});
const pending = (): ApprovalPendingMessage => ({
  type: "approval.pending",
  topic: "session.s",
  source: "opencode",
  seq: ++seq,
  ts: Date.now(),
  approval_id: "permission",
  status: "pending",
  deadline: Date.now() + 1000,
  raw: {
    type: "permission.asked",
    properties: { sessionID: "child", id: "native-permission", patterns: ["*"] },
  },
});

it("clears Stop on native completion without waiting for a separate idle event", () => {
  native({ type: "session.status", properties: { sessionID: "root", status: { type: "busy" } } });
  const view = render(<Composer sessionId="s" />);
  expect(view.getByRole("button", { name: "Stop" })).toBeTruthy();
  act(() => native(finish("child")));
  expect(view.getByRole("button", { name: "Stop" })).toBeTruthy();
  act(() => native(finish("root", "tool-calls")));
  expect(view.getByRole("button", { name: "Stop" })).toBeTruthy();
  act(() => native(finish()));
  expect(view.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(view.getByRole("button", { name: "Send" })).toBeTruthy();
  expect(isSessionBusy(sessionsStore.getState().sessions.s)).toBe(false);
});

it.each(["expiry", "answer"])(
  "clears the busy approval count on local %s without a resolution frame",
  async (resolution) => {
    native({ type: "session.status", properties: { sessionID: "root", status: { type: "busy" } } });
    dispatchFrame(pending());
    native(finish());
    const view = render(<Composer sessionId="s" />);
    expect(view.getByRole("button", { name: "Stop" })).toBeTruthy();
    await act(async () => {
      if (resolution === "expiry") approvalsStore.getState().tick(Date.now() + 2000);
      else {
        setApprovalTransport({
          answer: async () => ({ approval_id: "permission", status: "answered" }),
          cancel: async () => ({ approval_id: "permission", status: "cancelled" }),
        });
        await approvalsStore.getState().answer("permission", "once");
      }
    });
    expect(sessionsStore.getState().sessions.s?.pendingApprovals).toBe(0);
    expect(view.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(view.getByRole("button", { name: "Send" })).toBeTruthy();
  },
);
