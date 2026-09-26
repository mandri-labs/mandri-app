import { beforeEach, describe, expect, it } from "vitest";
import { DaemonError } from "@/daemon/errors";
import { loadFixture } from "@/daemon/fixtures/load";
import { validateFixtureFrames } from "@/daemon/fixtures/replay";
import type {
  ApprovalAnswerParams,
  ApprovalAnswerResult,
  ApprovalCancelParams,
  ApprovalCancelResult,
  ApprovalPendingMessage,
  ApprovalResolvedMessage,
} from "@/daemon/types/ws";
import { setApprovalTransport } from "@/stores/approvals";
import type { ApprovalTransport, ApprovalsState } from "@/stores/approvals";
import { approvalsStore, selectApprovalCount } from "@/stores/approvals";
import { sessionsStore } from "@/stores/sessions";

const BASE_TS = 1_788_552_436_716;

function pendingFrame(overrides: Partial<ApprovalPendingMessage> = {}): ApprovalPendingMessage {
  return {
    type: "approval.pending",
    topic: "session.s1",
    seq: 1,
    source: "claude",
    raw: {
      type: "control_request",
      request_id: "req-1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "git --version" },
      },
    },
    ts: BASE_TS,
    approval_id: "ap-1",
    deadline: BASE_TS + 120_000,
    status: "pending",
    ...overrides,
  };
}

function resolvedFrame(
  overrides: Partial<ApprovalResolvedMessage> = {},
): ApprovalResolvedMessage {
  return {
    type: "approval.resolved",
    topic: "session.s1",
    seq: 2,
    source: "mandri",
    raw: { approval_id: "ap-1", outcome: "answered", decision: "deny" },
    ts: BASE_TS + 1000,
    approval_id: "ap-1",
    outcome: "answered",
    decision: "deny",
    ...overrides,
  };
}

function codexPendingFrame(approvalId: string, deadline: number): ApprovalPendingMessage {
  return {
    type: "approval.pending",
    topic: "session.sx",
    seq: 1,
    source: "codex",
    raw: {
      method: "execApproval/request",
      params: { command: ["git", "--version"], cwd: "D:/Dev/demo" },
    },
    ts: BASE_TS,
    approval_id: approvalId,
    deadline,
    status: "pending",
  };
}

class RecordingTransport implements ApprovalTransport {
  readonly answers: ApprovalAnswerParams[] = [];
  readonly cancels: ApprovalCancelParams[] = [];
  failWith: { code: string } | null = null;

  answer(params: ApprovalAnswerParams): Promise<ApprovalAnswerResult> {
    this.answers.push(params);
    if (this.failWith !== null) {
      return Promise.reject(
        new DaemonError({ code: this.failWith.code, message: "rejected" }),
      );
    }
    return Promise.resolve({ approval_id: params.approval_id, status: "answered" });
  }

  cancel(params: ApprovalCancelParams): Promise<ApprovalCancelResult> {
    this.cancels.push(params);
    if (this.failWith !== null) {
      return Promise.reject(
        new DaemonError({ code: this.failWith.code, message: "rejected" }),
      );
    }
    return Promise.resolve({ approval_id: params.approval_id, status: "cancelled" });
  }
}

function state(): ApprovalsState {
  return approvalsStore.getState();
}

function requireView(approvalId: string) {
  const view = state().pending[approvalId];
  if (view === undefined) {
    throw new Error(`pending approval not found: ${approvalId}`);
  }
  return view;
}

async function fixtureApprovalFrames(harness: "claude" | "opencode") {
  const fixture = await loadFixture(harness, "approval");
  expect(fixture).not.toBeNull();
  const { frames } = validateFixtureFrames(fixture as NonNullable<typeof fixture>);
  const pending = frames.filter(
    (frame): frame is ApprovalPendingMessage => "type" in frame && frame.type === "approval.pending",
  );
  const resolved = frames.filter(
    (frame): frame is ApprovalResolvedMessage => "type" in frame && frame.type === "approval.resolved",
  );
  return { pending, resolved };
}

beforeEach(() => {
  approvalsStore.getState().reset();
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
  setApprovalTransport(null);
});

describe("fixture replay into approvals store", () => {
  it("ingests the claude approval fixture as a pending command_execution card", async () => {
    const { pending } = await fixtureApprovalFrames("claude");
    expect(pending).toHaveLength(1);
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    const view = requireView("565c7767-7959-46f8-a8fe-2e4b5bbca8bf");
    expect(view.harness).toBe("claude");
    expect(view.kind).toBe("command_execution");
    expect(view.status).toBe("pending");
    expect(view.deadline).toBe(1_788_552_556_716);
    expect(selectApprovalCount(state(), view.sessionId)).toBe(1);
  });

  it("keeps replaying the same pending frame idempotent by approval_id", async () => {
    const { pending } = await fixtureApprovalFrames("opencode");
    expect(pending).toHaveLength(1);
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    expect(Object.keys(state().pending)).toHaveLength(1);
  });

  it("does not resurrect a resolved approval when its pending frame is replayed after reconnect", async () => {
    const { pending, resolved } = await fixtureApprovalFrames("claude");
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    state().ingestFrame(resolved[0] as ApprovalResolvedMessage);
    expect(state().pending).toEqual({});
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    expect(state().pending).toEqual({});
    expect(state().recent).toHaveLength(1);
  });

  it("classifies the opencode permission.asked fixture as command_execution", async () => {
    const { pending } = await fixtureApprovalFrames("opencode");
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    const views = Object.values(state().pending);
    expect(views).toHaveLength(1);
    expect(views[0]?.harness).toBe("opencode");
    expect(views[0]?.kind).toBe("command_execution");
  });
});

describe("answer flow with reconciling resolved frame", () => {
  it("answers a claude approval with a valid variant then reconciles on approval.resolved", async () => {
    const transport = new RecordingTransport();
    setApprovalTransport(transport);
    const { pending, resolved } = await fixtureApprovalFrames("claude");
    const approvalId = pending[0] as unknown as ApprovalPendingMessage;
    state().ingestFrame(approvalId);
    await state().answer("565c7767-7959-46f8-a8fe-2e4b5bbca8bf", "deny");
    expect(transport.answers).toEqual([
      { approval_id: "565c7767-7959-46f8-a8fe-2e4b5bbca8bf", decision: "deny" },
    ]);
    expect(state().pending).toEqual({});
    expect(state().recent[0]?.status).toBe("answered");
    expect(state().recent[0]?.decision).toBe("deny");
    state().ingestFrame(resolved[0] as ApprovalResolvedMessage);
    expect(state().recent).toHaveLength(1);
    expect(state().recent[0]?.decision).toBe("deny");
  });

  it("answers opencode with the once variant and reconciles the recorded deny decision", async () => {
    const transport = new RecordingTransport();
    setApprovalTransport(transport);
    const { pending, resolved } = await fixtureApprovalFrames("opencode");
    const approvalId = (pending[0] as ApprovalPendingMessage).approval_id;
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    await state().answer(approvalId, "once");
    expect(transport.answers).toEqual([{ approval_id: approvalId, decision: "once" }]);
    state().ingestFrame(resolved[0] as ApprovalResolvedMessage);
    expect(state().recent[0]?.decision).toBe("deny");
    expect(state().recent[0]?.status).toBe("answered");
  });

  it("answers codex acceptForSession from a synthetic pending frame", async () => {
    const transport = new RecordingTransport();
    setApprovalTransport(transport);
    state().ingestFrame(codexPendingFrame("cx-1", BASE_TS + 120_000));
    await state().answer("cx-1", "acceptForSession");
    expect(transport.answers).toEqual([
      { approval_id: "cx-1", decision: "acceptForSession" },
    ]);
    expect(state().pending).toEqual({});
    expect(state().recent[0]?.status).toBe("answered");
  });
});

describe("expiry and cancel", () => {
  it("keeps the card pending just before the deadline and expires it once it passes", async () => {
    const { pending } = await fixtureApprovalFrames("claude");
    const approvalId = (pending[0] as ApprovalPendingMessage).approval_id;
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    state().tick((pending[0] as ApprovalPendingMessage).deadline - 1);
    expect(state().pending[approvalId]?.status).toBe("pending");
    state().tick((pending[0] as ApprovalPendingMessage).deadline);
    expect(state().pending).toEqual({});
    expect(state().recent[0]?.status).toBe("expired");
    state().ingestFrame(
      resolvedFrame({ approval_id: approvalId, outcome: "expired", decision: undefined }),
    );
    expect(state().recent.filter((view) => view.approvalId === approvalId)).toHaveLength(1);
    expect(state().recent[0]?.status).toBe("expired");
  });

  it("cancels a pending approval through the cancel op", async () => {
    const transport = new RecordingTransport();
    setApprovalTransport(transport);
    const { pending } = await fixtureApprovalFrames("opencode");
    const approvalId = (pending[0] as ApprovalPendingMessage).approval_id;
    state().ingestFrame(pending[0] as ApprovalPendingMessage);
    await state().cancel(approvalId);
    expect(transport.cancels).toEqual([{ approval_id: approvalId }]);
    expect(state().pending).toEqual({});
    expect(state().recent[0]?.status).toBe("cancelled");
  });
});

describe("invalid-state answers", () => {
  it("records approval_not_pending when answering an unknown approval", async () => {
    const transport = new RecordingTransport();
    setApprovalTransport(transport);
    await state().answer("missing", "allow");
    expect(transport.answers).toHaveLength(0);
    expect(state().errors["missing"]).toBe("approval_not_pending");
    expect(state().clearError("missing")).toBeUndefined();
    expect(state().errors["missing"]).toBeUndefined();
  });

  it("resolves locally when the daemon reports approval_already_answered", async () => {
    const transport = new RecordingTransport();
    transport.failWith = { code: "approval_already_answered" };
    setApprovalTransport(transport);
    state().ingestFrame(pendingFrame());
    await state().answer("ap-1", "allow");
    expect(state().pending).toEqual({});
    expect(state().recent[0]?.status).toBe("answered");
    expect(state().errors["ap-1"]).toBe("approval_already_answered");
  });

  it("resolves locally as expired when the daemon reports approval_expired", async () => {
    const transport = new RecordingTransport();
    transport.failWith = { code: "approval_expired" };
    setApprovalTransport(transport);
    state().ingestFrame(pendingFrame());
    await state().answer("ap-1", "allow");
    expect(state().recent[0]?.status).toBe("expired");
    expect(state().errors["ap-1"]).toBe("approval_expired");
  });

  it("reverts the optimistic answer to pending on transport failures that leave state unknown", async () => {
    const transport = new RecordingTransport();
    transport.failWith = { code: "service_unavailable" };
    setApprovalTransport(transport);
    state().ingestFrame(pendingFrame());
    await state().answer("ap-1", "allow");
    expect(state().pending["ap-1"]?.status).toBe("pending");
    expect(state().recent).toHaveLength(0);
    expect(state().errors["ap-1"]).toBe("service_unavailable");
  });
});

describe("harness variant sets", () => {
  it("exposes the per-harness decision variants from the capability table", async () => {
    const { HARNESS_VARIANTS } = await import("@/stores/approvals");
    expect(HARNESS_VARIANTS.claude.map((variant) => variant.decision)).toEqual(["allow", "deny"]);
    expect(HARNESS_VARIANTS.codex.map((variant) => variant.decision)).toEqual([
      "accept",
      "acceptForSession",
      "decline",
      "cancel",
    ]);
    expect(HARNESS_VARIANTS.opencode.map((variant) => variant.decision)).toEqual([
      "once",
      "always",
      "deny",
    ]);
    expect(HARNESS_VARIANTS.opencode[2]?.labelKey).toBe("core.approvals.decision_reject");
  });
});

describe("kind classification", () => {
  it("classifies synthetic codex and opencode raws and unknown payloads", async () => {
    const { classifyKind } = await import("@/stores/approvals");
    expect(classifyKind("codex", { method: "execApproval/request", params: { command: ["ls"] } })).toBe(
      "command_execution",
    );
    expect(classifyKind("codex", { method: "applyPatchApproval/request", params: { patch: "***" } })).toBe(
      "file_change",
    );
    expect(
      classifyKind("opencode", {
        type: "permission.asked",
        properties: { permission: "edit", patterns: ["src/**"] },
      }),
    ).toBe("permission_scope");
    expect(
      classifyKind("claude", {
        type: "control_request",
        request: {
          subtype: "can_use_tool",
          tool_name: "Edit",
          input: { file_path: "D:/Dev/demo/app.ts" },
        },
      }),
    ).toBe("file_change");
    expect(
      classifyKind("claude", {
        type: "control_request",
        request: {
          subtype: "can_use_tool",
          tool_name: "AskUserQuestion",
          input: { questions: [{ question: "Proceed?" }] },
        },
      }),
    ).toBe("user_input");
    expect(
      classifyKind("claude", {
        type: "control_request",
        request: { subtype: "can_use_tool", tool_name: "mcp__server__prompt" },
      }),
    ).toBe("elicitation");
    expect(
      classifyKind("claude", {
        type: "control_request",
        request: {
          subtype: "can_use_tool",
          tool_name: "WebFetch",
          input: {},
          permission_suggestions: [
            {
              type: "addRules",
              rules: [{ toolName: "WebFetch", ruleContent: "WebFetch(domain:example.com)" }],
            },
          ],
        },
      }),
    ).toBe("permission_scope");
    expect(classifyKind("codex", { nothing: true })).toBe("unknown");
    expect(classifyKind("codex", "not-an-object")).toBe("unknown");
  });
});

describe("recent ring", () => {
  it("caps resolved approvals at the last 20", () => {
    for (let index = 0; index < 25; index += 1) {
      state().ingestFrame(
        pendingFrame({
          approval_id: `ap-${index}`,
          topic: "session.s1",
          seq: index + 1,
        }),
      );
      state().ingestFrame(
        resolvedFrame({
          approval_id: `ap-${index}`,
          topic: "session.s1",
          seq: 1000 + index,
        }),
      );
    }
    expect(state().recent).toHaveLength(20);
    expect(state().recent[0]?.approvalId).toBe("ap-24");
  });
});

describe("session badge selector", () => {
  it("counts pending approvals per session and falls back to undefined when empty", async () => {
    const { pending } = await fixtureApprovalFrames("claude");
    const approvalId = pending[0] as ApprovalPendingMessage;
    expect(selectApprovalCount(state(), approvalId.topic.replace("session.", ""))).toBeUndefined();
    state().ingestFrame(approvalId);
    expect(selectApprovalCount(state(), approvalId.topic.replace("session.", ""))).toBe(1);
    state().tick(approvalId.deadline);
    expect(selectApprovalCount(state(), approvalId.topic.replace("session.", ""))).toBeUndefined();
  });
});
