import { createStore } from "zustand/vanilla";
import { DaemonError } from "@/daemon/errors";
import { getDaemonSocket } from "@/app/connection";
import { createCachedSelector } from "@/app/useStore";
import { agentsStore } from "@/stores/agents";
import type {
  ApprovalAnswerParams,
  ApprovalAnswerResult,
  ApprovalCancelParams,
  ApprovalCancelResult,
  ApprovalDecision,
  ApprovalPendingMessage,
  HarnessKind,
  ResolvedApprovalStatus,
  ServerMessage,
  WsTopic,
} from "@/daemon/types/ws";

export type ApprovalKind =
  | "command_execution"
  | "file_change"
  | "permission_scope"
  | "user_input"
  | "elicitation"
  | "unknown";

export type ApprovalViewStatus = "pending" | "answered" | "expired" | "cancelled";

export interface ApprovalView {
  agentId?: string;
  approvalId: string;
  sessionId: string;
  harness: HarnessKind;
  kind: ApprovalKind;
  raw: unknown;
  deadline: number;
  status: ApprovalViewStatus;
  decision?: ApprovalDecision;
  answeredAt?: number;
}

export interface ApprovalVariant {
  decision: ApprovalDecision;
  labelKey: string;
}

export const HARNESS_VARIANTS: Record<HarnessKind, readonly ApprovalVariant[]> = {
  pi: [
    { decision: "accept", labelKey: "core.approvals.decision_accept" },
    { decision: "deny", labelKey: "core.approvals.decision_deny" },
  ],
  claude: [
    { decision: "allow", labelKey: "core.approvals.decision_allow" },
    { decision: "deny", labelKey: "core.approvals.decision_deny" },
  ],
  codex: [
    { decision: "accept", labelKey: "core.approvals.decision_accept" },
    { decision: "acceptForSession", labelKey: "core.approvals.decision_accept_for_session" },
    { decision: "decline", labelKey: "core.approvals.decision_decline" },
    { decision: "cancel", labelKey: "core.approvals.decision_cancel" },
  ],
  agy: [
    { decision: "allow", labelKey: "core.approvals.decision_allow" },
    { decision: "always", labelKey: "core.approvals.decision_accept_for_session" },
    { decision: "deny", labelKey: "core.approvals.decision_deny" },
  ],
  opencode: [
    { decision: "once", labelKey: "core.approvals.decision_once" },
    { decision: "always", labelKey: "core.approvals.decision_always" },
    { decision: "deny", labelKey: "core.approvals.decision_reject" },
  ],
};

const DECISION_LABEL_KEYS: Record<ApprovalDecision, string> = {
  allow: "core.approvals.decision_allow",
  deny: "core.approvals.decision_deny",
  once: "core.approvals.decision_once",
  always: "core.approvals.decision_always",
  accept: "core.approvals.decision_accept",
  acceptForSession: "core.approvals.decision_accept_for_session",
  decline: "core.approvals.decision_decline",
  cancel: "core.approvals.decision_cancel",
};

export function decisionLabelKey(decision: ApprovalDecision): string {
  return DECISION_LABEL_KEYS[decision];
}

export const RECENT_APPROVALS_LIMIT = 20;

const CLAUDE_FILE_TOOLS: readonly string[] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

export interface ApprovalTransport {
  answer: (params: ApprovalAnswerParams) => Promise<ApprovalAnswerResult>;
  cancel: (params: ApprovalCancelParams) => Promise<ApprovalCancelResult>;
}

function defaultTransport(): ApprovalTransport {
  return {
    answer: (params) => {
      const socket = getDaemonSocket();
      if (socket === null) {
        return Promise.reject(
          new DaemonError({ code: "service_unavailable", message: "socket not connected" }),
        );
      }
      return socket.request("approval.answer", params);
    },
    cancel: (params) => {
      const socket = getDaemonSocket();
      if (socket === null) {
        return Promise.reject(
          new DaemonError({ code: "service_unavailable", message: "socket not connected" }),
        );
      }
      return socket.request("approval.cancel", params);
    },
  };
}

let transport: ApprovalTransport = defaultTransport();

export function setApprovalTransport(next: ApprovalTransport | null): void {
  transport = next ?? defaultTransport();
}

export interface ApprovalsState {
  pending: Record<string, ApprovalView>;
  recent: readonly ApprovalView[];
  errors: Record<string, string>;
  submitting: Record<string, boolean>;
  ingestFrame: (message: ServerMessage) => void;
  answer: (approvalId: string, decision: ApprovalDecision, answers?: ApprovalAnswerParams["answers"]) => Promise<void>;
  cancel: (approvalId: string) => Promise<void>;
  tick: (now: number) => void;
  clearError: (approvalId: string) => void;
  reset: () => void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function classifyKind(harness: HarnessKind, raw: unknown): ApprovalKind {
  const record = asRecord(raw);
  if (record === undefined) {
    return "unknown";
  }
  if (harness === "pi") {
    return record["method"] === "confirm" ? "permission_scope" : "user_input";
  }
  if (harness === "agy") {
    const call = asRecord(record["toolCall"] ?? asRecord(record["data"])?.["toolCall"]);
    const args = asRecord(call?.["args"]);
    if (call?.["name"] === "ask_question") return "user_input";
    if (typeof args?.["CommandLine"] === "string") return "command_execution";
    if (args?.["TargetFile"] !== undefined) return "file_change";
    return "permission_scope";
  }
  if (harness === "claude") {
    const request = asRecord(record["request"]);
    const input = asRecord(request?.["input"]);
    const toolName = typeof request?.["tool_name"] === "string" ? request["tool_name"] : undefined;
    if (toolName === "Bash" || typeof input?.["command"] === "string") {
      return "command_execution";
    }
    if (toolName === "AskUserQuestion") {
      return "user_input";
    }
    if (typeof toolName === "string" && toolName.startsWith("mcp__")) {
      return "elicitation";
    }
    if (
      (toolName !== undefined && CLAUDE_FILE_TOOLS.includes(toolName)) ||
      input?.["file_path"] !== undefined ||
      input?.["edits"] !== undefined
    ) {
      return "file_change";
    }
    if (request?.["permission_suggestions"] !== undefined) {
      return "permission_scope";
    }
    return "unknown";
  }
  if (harness === "opencode") {
    const props = asRecord(record["properties"]);
    const metadata = asRecord(props?.["metadata"]);
    if (typeof metadata?.["command"] === "string") {
      return "command_execution";
    }
    if (Array.isArray(props?.["patterns"])) {
      return "permission_scope";
    }
    return "unknown";
  }
  const params = asRecord(record["params"]);
  const command = params?.["command"] ?? params?.["cmd"] ?? record["command"];
  if (typeof command === "string" || Array.isArray(command)) {
    return "command_execution";
  }
  if (params?.["patch"] !== undefined || params?.["changes"] !== undefined) {
    return "file_change";
  }
  if (record["grant_reason"] !== undefined || Array.isArray(record["patterns"])) {
    return "permission_scope";
  }
  return "unknown";
}

function sessionIdFromTopic(topic: WsTopic): string {
  return topic.startsWith("session.") ? topic.slice("session.".length) : topic;
}

function sessionIdOfPending(message: ApprovalPendingMessage): string {
  if (message.topic.startsWith("session.")) {
    return sessionIdFromTopic(message.topic);
  }
  const agentId = agentIdOfPending(message);
  const parent = agentId ? agentsStore.getState().agents[agentId]?.parent_session_id : undefined;
  if (parent) return parent;
  const rawSession = asRecord(message.raw)?.["session_id"];
  return typeof rawSession === "string" ? rawSession : message.approval_id;
}

function agentIdOfPending(message: ApprovalPendingMessage): string | undefined {
  return (
    message.agent_id ??
    (message.topic.startsWith("agent.") ? message.topic.slice("agent.".length) : undefined)
  );
}

function errorOf(error: unknown): string {
  return error instanceof DaemonError ? error.code : "unknown";
}

const LOCAL_RESOLUTION_CODES: readonly string[] = [
  "approval_not_pending",
  "approval_already_answered",
  "approval_expired",
];

export const approvalsStore = createStore<ApprovalsState>()((set, get) => {
  function resolveView(
    approvalId: string,
    status: ResolvedApprovalStatus,
    options?: { decision?: ApprovalDecision | null; answeredAt?: number },
  ): void {
    const state = get();
    const source =
      state.pending[approvalId] ??
      state.recent.find((view) => view.approvalId === approvalId) ??
      undefined;
    const pending = { ...state.pending };
    delete pending[approvalId];
    const resolved: ApprovalView = {
      approvalId,
      agentId: source?.agentId,
      sessionId: source?.sessionId ?? "",
      harness: source?.harness ?? "claude",
      kind: source?.kind ?? "unknown",
      raw: source?.raw ?? null,
      deadline: source?.deadline ?? 0,
      status,
      decision: options?.decision ?? source?.decision,
      answeredAt: options?.answeredAt ?? source?.answeredAt ?? Date.now(),
    };
    set({
      pending,
      recent: dedupeRecent([
        resolved,
        ...state.recent.filter((view) => view.approvalId !== approvalId),
      ]),
    });
  }

  function dedupeRecent(views: ApprovalView[]): ApprovalView[] {
    return views.slice(0, RECENT_APPROVALS_LIMIT);
  }

  function handleProtocolError(
    approvalId: string,
    error: unknown,
    fallbackStatus: ResolvedApprovalStatus,
  ): void {
    const code = errorOf(error);
    if (LOCAL_RESOLUTION_CODES.includes(code)) {
      resolveView(approvalId, code === "approval_expired" ? "expired" : fallbackStatus, {});
      set((state) => ({ errors: { ...state.errors, [approvalId]: code } }));
      return;
    }
    set((state) => ({ errors: { ...state.errors, [approvalId]: code } }));
  }

  function setSubmitting(approvalId: string, value: boolean): void {
    set((state) => {
      const submitting = { ...state.submitting };
      if (value) submitting[approvalId] = true;
      else delete submitting[approvalId];
      return { submitting };
    });
  }

  return {
    pending: {},
    recent: [],
    errors: {},
    submitting: {},

    ingestFrame: (message) => {
      if ("type" in message && message.type === "approval.pending") {
        const state = get();
        const existing = state.pending[message.approval_id];
        const agentId = agentIdOfPending(message);
        if (existing !== undefined) {
          const sessionId =
            message.topic.startsWith("session.") || existing.sessionId === message.approval_id
              ? sessionIdOfPending(message)
              : existing.sessionId;
          if (sessionId !== existing.sessionId || (agentId && agentId !== existing.agentId)) {
            set({
              pending: {
                ...state.pending,
                [message.approval_id]: {
                  ...existing,
                  sessionId,
                  agentId: agentId ?? existing.agentId,
                },
              },
            });
          }
          return;
        }
        if (state.recent.some((view) => view.approvalId === message.approval_id)) {
          return;
        }
        const view: ApprovalView = {
          agentId,
          approvalId: message.approval_id,
          sessionId: sessionIdOfPending(message),
          harness: message.source,
          kind: classifyKind(message.source, message.raw),
          raw: message.raw,
          deadline: message.deadline,
          status: "pending",
        };
        set({ pending: { ...state.pending, [message.approval_id]: view } });
        return;
      }
      if ("type" in message && message.type === "approval.resolved") {
        resolveView(message.approval_id, message.outcome, {
          decision: message.decision ?? undefined,
          answeredAt: message.ts,
        });
      }
    },

    answer: async (approvalId, decision, answers) => {
      const state = get();
      if (state.submitting[approvalId]) return;
      const view = state.pending[approvalId];
      if (view === undefined) {
        const known = state.recent.some((entry) => entry.approvalId === approvalId);
        set({
          errors: {
            ...state.errors,
            [approvalId]: known ? "approval_already_answered" : "approval_not_pending",
          },
        });
        return;
      }
      const answeredAt = Date.now();
      setSubmitting(approvalId, true);
      try {
        await transport.answer({ approval_id: approvalId, decision, ...(answers ? { answers } : {}) });
        if (get().pending[approvalId])
          resolveView(approvalId, "answered", { decision, answeredAt });
        set((current) => {
          const errors = { ...current.errors };
          delete errors[approvalId];
          return { errors };
        });
      } catch (error) {
        handleProtocolError(approvalId, error, "answered");
      } finally {
        setSubmitting(approvalId, false);
      }
    },

    cancel: async (approvalId) => {
      const state = get();
      if (state.submitting[approvalId]) return;
      const view = state.pending[approvalId];
      if (view === undefined) {
        set({ errors: { ...state.errors, [approvalId]: "approval_not_pending" } });
        return;
      }
      setSubmitting(approvalId, true);
      try {
        await transport.cancel({ approval_id: approvalId });
        if (get().pending[approvalId])
          resolveView(approvalId, "cancelled", { answeredAt: Date.now() });
        set((current) => {
          const errors = { ...current.errors };
          delete errors[approvalId];
          return { errors };
        });
      } catch (error) {
        handleProtocolError(approvalId, error, "cancelled");
      } finally {
        setSubmitting(approvalId, false);
      }
    },

    tick: (now) => {
      const state = get();
      const expired = Object.values(state.pending).filter(
        (view) => view.status === "pending" && view.deadline <= now,
      );
      if (expired.length === 0) {
        return;
      }
      const pending = { ...state.pending };
      let recent = [...state.recent];
      for (const view of expired) {
        delete pending[view.approvalId];
        recent = [
          { ...view, status: "expired", answeredAt: now },
          ...recent.filter((entry) => entry.approvalId !== view.approvalId),
        ];
      }
      set({ pending, recent: dedupeRecent(recent) });
    },

    clearError: (approvalId) => {
      set((state) => {
        if (state.errors[approvalId] === undefined) {
          return state;
        }
        const errors = { ...state.errors };
        delete errors[approvalId];
        return { errors };
      });
    },

    reset: () => {
      set({ pending: {}, recent: [], errors: {}, submitting: {} });
    },
  };
});

export function selectApprovalCount(state: ApprovalsState, sessionId: string): number | undefined {
  const entries = Object.values(state.pending);
  if (entries.length === 0) {
    return undefined;
  }
  return entries.filter((view) => view.sessionId === sessionId).length;
}

export const selectPendingApprovals = createCachedSelector(
  (state: ApprovalsState) => state.pending,
  (pending) =>
    Object.values(pending).sort(
      (a, b) => a.deadline - b.deadline || a.approvalId.localeCompare(b.approvalId),
    ),
);
