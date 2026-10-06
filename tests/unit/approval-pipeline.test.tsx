import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { sessionsStore } from "@/stores/sessions";
import { dispatchFrame } from "@/app/framePipeline";
import { approvalsStore, setApprovalTransport } from "@/stores/approvals";
import { SessionApprovals } from "@/features/approvals/SessionApprovals";
import { initI18n } from "@/i18n";
import type { ApprovalPendingMessage } from "@/daemon/types/ws";
import { DaemonError } from "@/daemon/errors";

function pending(): ApprovalPendingMessage {
  return {
    type: "approval.pending",
    topic: "session.s1",
    seq: 1,
    source: "claude",
    ts: Date.now(),
    approval_id: "a1",
    deadline: Date.now() + 120000,
    status: "pending",
    raw: {
      type: "control_request",
      request_id: "r1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "git --version" },
      },
    },
  };
}
beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => approvalsStore.getState().reset());
afterEach(() => {
  cleanup();
  setApprovalTransport(null);
});
it("delivers a native approval through the pipeline and allows answering in the session", async () => {
  const answer = vi.fn(async () => ({ approval_id: "a1", status: "answered" as const }));
  setApprovalTransport({ answer, cancel: vi.fn() });
  dispatchFrame(pending());
  render(<SessionApprovals sessionId="s1" />);
  expect(screen.getByText("git --version")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() =>
    expect(answer).toHaveBeenCalledWith({ approval_id: "a1", decision: "allow" }),
  );
  expect(approvalsStore.getState().pending.a1).toBeUndefined();
  await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
});
it("deduplicates replayed approvals and removes expired cards", () => {
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness: "claude",
        state: "live",
        deleted: false,
        title: "Session",
        pendingApprovals: 0,
      },
    },
  });
  dispatchFrame(pending());
  dispatchFrame({ ...pending(), seq: 2 });
  expect(sessionsStore.getState().sessions.s1?.pendingApprovals).toBe(1);
  dispatchFrame({
    type: "approval.resolved",
    topic: "session.s1",
    seq: 3,
    source: "mandri",
    ts: Date.now(),
    raw: {},
    approval_id: "a1",
    outcome: "expired",
    decision: null,
  });
  render(<SessionApprovals sessionId="s1" />);
  expect(screen.queryByRole("article")).toBeNull();
  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  expect(approvalsStore.getState().recent).toHaveLength(1);
  expect(sessionsStore.getState().sessions.s1?.pendingApprovals).toBe(0);
});
it("does not show another session's approvals", () => {
  dispatchFrame(pending());
  render(<SessionApprovals sessionId="s2" />);
  expect(screen.queryByText("git --version")).toBeNull();
});

it("keeps the request visible during delivery and permits retry after a failure", async () => {
  let reject!: (error: unknown) => void;
  const answer = vi.fn(
    () =>
      new Promise<never>((_, fail) => {
        reject = fail;
      }),
  );
  setApprovalTransport({ answer, cancel: vi.fn() });
  dispatchFrame(pending());
  render(<SessionApprovals sessionId="s1" />);
  const allow = screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement;
  fireEvent.click(allow);
  fireEvent.click(allow);
  expect(answer).toHaveBeenCalledTimes(1);
  expect(allow.disabled).toBe(true);
  expect(screen.getByText("git --version")).toBeTruthy();
  await act(async () =>
    reject(new DaemonError({ code: "service_unavailable", message: "offline" })),
  );
  expect(allow.disabled).toBe(false);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(allow);
  expect(answer).toHaveBeenCalledTimes(2);
  await act(async () =>
    reject(new DaemonError({ code: "service_unavailable", message: "offline" })),
  );
});

it("does not repeat a command from Claude's permission suggestions", () => {
  const frame = pending();
  frame.raw = {
    request: {
      tool_name: "Bash",
      input: { command: "git --version" },
      permission_suggestions: [{ rules: [{ ruleContent: "git --version" }] }],
    },
  };
  dispatchFrame(frame);
  const { container } = render(<SessionApprovals sessionId="s1" />);
  expect(screen.getAllByText("git --version")).toHaveLength(1);
  expect(container.querySelector(".approval-harness")).toBeNull();
});
