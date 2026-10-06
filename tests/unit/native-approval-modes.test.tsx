import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { dispatchFrame } from "@/app/framePipeline";
import { parseServerMessage } from "@/daemon/ws/protocol";
import type { ApprovalPendingMessage } from "@/daemon/types/ws";
import { SessionApprovals } from "@/features/approvals/SessionApprovals";
import { approvalsStore, classifyKind, setApprovalTransport } from "@/stores/approvals";
import { sessionsStore } from "@/stores/sessions";
import { initI18n } from "@/i18n";

beforeAll(() => initI18n("en"));
beforeEach(() => {
  approvalsStore.getState().reset();
  sessionsStore.setState({
    sessions: {
      s: {
        id: "s",
        harness: "claude",
        state: "live",
        deleted: false,
        title: "Synthetic",
        pendingApprovals: 0,
        interactionMode: "bypassPermissions",
      },
    },
    order: ["s"],
  });
});
afterEach(() => {
  cleanup();
  setApprovalTransport(null);
});

function pending(source: ApprovalPendingMessage["source"], raw: unknown): ApprovalPendingMessage {
  return {
    type: "approval.pending",
    topic: "session.s",
    seq: 1,
    source,
    raw,
    ts: Date.now(),
    approval_id: "request",
    deadline: Date.now() + 120000,
    status: "pending",
  };
}

it("shows the plan and sends the selected execution mode without changing its label optimistically", async () => {
  sessionsStore.getState().applySessionPatch("s", { interactionMode: "plan" });
  const answer = vi.fn(async () => ({ approval_id: "request", status: "answered" as const }));
  setApprovalTransport({ answer, cancel: vi.fn() });
  dispatchFrame({
    ...pending("claude", {
      type: "control_request",
      request: {
        tool_name: "ExitPlanMode",
        input: { plan: "## Proposed change\nRepair native synchronization." },
      },
    }),
    kind: "permission_scope",
    permission_modes: ["default", "acceptEdits", "bypassPermissions"],
  });
  render(<SessionApprovals sessionId="s" />);
  expect(screen.getByRole("heading", { name: "Proposed change" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Keep planning" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Approve plan.*Bypass permissions/ }));
  await waitFor(() =>
    expect(answer).toHaveBeenCalledWith({
      approval_id: "request",
      decision: "allow",
      permission_mode: "bypassPermissions",
    }),
  );
  expect(sessionsStore.getState().sessions.s?.interactionMode).toBe("plan");
});

it("applies confirmed mode events and ignores older confirmations", () => {
  const wire = {
    type: "interaction_mode",
    topic: "session.s",
    seq: 2,
    source: "mandri",
    ts: 200,
    raw: { session_id: "s", harness: "claude", mode: "plan", applied: "mid_session_applied" },
  };
  const frame = parseServerMessage(wire);
  expect(frame).not.toBeNull();
  dispatchFrame(frame!);
  expect(sessionsStore.getState().sessions.s?.interactionMode).toBe("plan");
  dispatchFrame(
    parseServerMessage({
      ...wire,
      seq: 3,
      ts: 100,
      raw: { ...wire.raw, mode: "bypassPermissions" },
    })!,
  );
  expect(sessionsStore.getState().sessions.s?.interactionMode).toBe("plan");
});

it("keeps confirmed modes when an older REST response arrives", () => {
  sessionsStore.getState().ingestFrame({
    type: "interaction_mode",
    topic: "session.s",
    seq: 2,
    source: "mandri",
    ts: 200,
    raw: { session_id: "s", harness: "claude", mode: "plan", applied: "mid_session_applied" },
  });
  const row = {
    id: "s",
    harness: "claude",
    native_id: null,
    title: "Synthetic",
    project_path: "",
    created_at: 1,
    updated_at: 100,
    state: "live",
    model: null,
    interaction_mode: { mode: "bypassPermissions", applied: "at_launch" },
  } as const;
  sessionsStore.getState().upsertFromRest([row]);
  expect(sessionsStore.getState().sessions.s?.interactionMode).toBe("plan");
  sessionsStore.getState().upsertFromRest([{ ...row, updated_at: 300 }]);
  expect(sessionsStore.getState().sessions.s?.interactionMode).toBe("bypassPermissions");
  sessionsStore.getState().ingestFrame({
    type: "interaction_mode",
    topic: "session.s",
    seq: 3,
    source: "mandri",
    ts: 250,
    raw: { session_id: "s", harness: "claude", mode: "plan", applied: "mid_session_applied" },
  });
  expect(sessionsStore.getState().sessions.s?.interactionMode).toBe("bypassPermissions");
});

it.each(["opencode", "codex"] as const)(
  "answers %s questions using their native identifiers",
  async (source) => {
    const raw =
      source === "opencode"
        ? {
            type: "question.asked",
            properties: {
              id: "native",
              questions: [
                { question: "Choose environment", options: [{ label: "staging" }], custom: false },
              ],
            },
          }
        : {
            id: 7,
            method: "item/tool/requestUserInput",
            params: {
              questions: [
                {
                  id: "environment",
                  question: "Choose environment",
                  options: [{ label: "staging" }],
                },
              ],
            },
          };
    const answer = vi.fn(async () => ({ approval_id: "request", status: "answered" as const }));
    setApprovalTransport({ answer, cancel: vi.fn() });
    expect(classifyKind(source, raw)).toBe("user_input");
    dispatchFrame(pending(source, raw));
    render(<SessionApprovals sessionId="s" />);
    fireEvent.click(screen.getByLabelText("staging"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith({
        approval_id: "request",
        decision: source === "opencode" ? "once" : "accept",
        answers: [{ question: source === "opencode" ? "0" : "environment", answers: ["staging"] }],
      }),
    );
  },
);

it("uses the daemon's approval kind for a future native tool", () => {
  dispatchFrame({
    ...pending("claude", { request: { tool_name: "FutureNativeTool", input: {} } }),
    kind: "permission_scope",
  });
  render(<SessionApprovals sessionId="s" />);
  expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
});

it("refreshes native approval metadata when a pending request is replayed", () => {
  const frame = pending("claude", {
    request: { tool_name: "ExitPlanMode", input: {} },
  });
  dispatchFrame(frame);
  render(<SessionApprovals sessionId="s" />);
  expect(screen.queryByRole("button", { name: /Bypass permissions/ })).toBeNull();
  act(() => {
    dispatchFrame({
      ...frame,
      kind: "permission_scope",
      permission_modes: ["default", "bypassPermissions"],
    });
  });
  expect(screen.getByRole("button", { name: /Bypass permissions/ })).toBeTruthy();
});

it("grants exactly the displayed Codex permissions for the chosen scope", async () => {
  const permissions = { fileSystem: { write: ["/synthetic/output"] } };
  const answer = vi.fn(async () => ({ approval_id: "request", status: "answered" as const }));
  setApprovalTransport({ answer, cancel: vi.fn() });
  dispatchFrame(
    pending("codex", {
      id: 7,
      method: "item/permissions/requestApproval",
      params: { permissions },
    }),
  );
  render(<SessionApprovals sessionId="s" />);
  expect(screen.getByText(/synthetic\/output/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Accept for session" }));
  await waitFor(() =>
    expect(answer).toHaveBeenCalledWith({
      approval_id: "request",
      decision: "acceptForSession",
      updated_input: JSON.stringify({ permissions, scope: "session" }),
    }),
  );
});

it("submits typed MCP elicitation content without a generic accept response", async () => {
  const answer = vi.fn(async () => ({ approval_id: "request", status: "answered" as const }));
  setApprovalTransport({ answer, cancel: vi.fn() });
  dispatchFrame(
    pending("codex", {
      id: 7,
      method: "mcpServer/elicitation/request",
      params: {
        message: "Select a workspace",
        requestedSchema: {
          type: "object",
          required: ["name", "enabled"],
          properties: {
            name: { type: "string", title: "Workspace" },
            enabled: { type: "boolean", title: "Enabled" },
          },
        },
      },
    }),
  );
  render(<SessionApprovals sessionId="s" />);
  fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: "synthetic" } });
  fireEvent.change(screen.getByLabelText("Enabled"), { target: { value: "false" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  await waitFor(() =>
    expect(answer).toHaveBeenCalledWith({
      approval_id: "request",
      decision: "accept",
      updated_input: JSON.stringify({
        action: "accept",
        content: { name: "synthetic", enabled: false },
      }),
    }),
  );
  expect(screen.queryByRole("button", { name: "Accept for session" })).toBeNull();
});
