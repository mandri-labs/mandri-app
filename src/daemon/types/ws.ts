import type { ConversationStatus } from "./conversationStatus";
import type { CommandParams, CommandRequest, CommandResults } from "./commands";
export type HarnessKind = "codex" | "claude" | "opencode" | "agy" | "pi";

export type SessionState = "discovered" | "live" | "stopped";

export type ActivityState = "active" | "idle";

export type SessionStopCause = "viewer_stop" | "crash" | "daemon_stop" | "idle_timeout";

export type ApprovalStatus = "pending" | "answered" | "expired" | "cancelled";

export type ResolvedApprovalStatus = Exclude<ApprovalStatus, "pending">;

export type ApprovalDecision =
  "allow" | "deny" | "once" | "always" | "accept" | "acceptForSession" | "decline" | "cancel";

export type ModeApplication =
  | "at_launch"
  | "restarted"
  | "mid_session_applied"
  | "next_turn_applied"
  | "hook_policy_applied"
  | "requires_restart";

export type AppliedMode = Exclude<ModeApplication, "requires_restart">;

export type PromptDeliveryState = "queued" | "steered";

export type ProtocolErrorCode =
  | "agent_unsupported"
  | "harness_store_unavailable"
  | "internal_error"
  | "session_conflict"
  | "unknown_action"
  | "session_not_running"
  | "approval_not_pending"
  | "approval_already_answered"
  | "approval_expired"
  | "steer_unsupported"
  | "steer_no_active_turn"
  | "mode_requires_restart"
  | "mode_rejected"
  | "delivery_unknown"
  | "prompt_delivery_failed"
  | "control_delivery_failed"
  | "invalid_params"
  | "duplicate_op_id";

export type WsTopic =
  | "conversations.all"
  | "sessions.all"
  | `session.${string}`
  | "agents.all"
  | `agent.${string}`
  | "runtimes"
  | "usage.changed"
  | "gateway.events"
  | "mcp.events";

export type EventSource = HarnessKind | "mandri" | "daemon";

export type DegradationKind = "oversize" | "incomplete" | "decode_error" | "parse_error";

export type GapReason = "retention_exceeded" | "history_lost" | "slow_consumer";

export type GatewayRouteEvent = "route_created" | "route_updated" | "route_deleted";

export type SessionLifecycleType =
  "session_started" | "session_stopped" | "session_state" | "activity" | "control_lost";

export interface SessionLifecyclePayload {
  type: SessionLifecycleType;
  session_id: string;
  harness: HarnessKind;
  state?: SessionState;
  activity?: ActivityState;
  last_activity_at?: number;
  cause?: SessionStopCause;
}

export interface DegradationPayload {
  error: DegradationKind;
  size?: number;
}

export interface RuntimeStatus {
  harness: HarnessKind;
  installed: boolean;
  degraded: boolean;
}

export interface GatewayEventPayload {
  event: GatewayRouteEvent;
  route_id?: string | null;
  provider_name?: string | null;
}

export interface SnapshotSession {
  id: string;
  harness: HarnessKind;
  state: SessionState;
  title: string;
  execution_backend?: "host" | "docker";
  privacy_mode?: "none" | "surrogate";
  policy_revision?: number;
}

export interface SubscribeMessage {
  op: "subscribe";
  topic: WsTopic;
  since?: number | null;
}

export interface UnsubscribeMessage {
  op: "unsubscribe";
  topic: WsTopic;
}

export interface PongMessage {
  type: "pong";
}

export interface ApprovalAnswerParams {
  permission_mode?: "default" | "acceptEdits" | "bypassPermissions" | "auto";
  answers?: { question: string; answers: string[] }[];
  approval_id: string;
  decision: ApprovalDecision;
  updated_input?: string | null;
}

export interface ApprovalCancelParams {
  approval_id: string;
}

export interface SessionModeParams {
  session_id: string;
  mode: string;
}

export interface SessionPromptParams {
  session_id: string;
  content: string;
  attachments?: string[];
  agent?: string | null;
  model?: string | null;
}

export interface SessionInterruptParams {
  session_id: string;
}

export type RequestAction =
  | keyof CommandParams
  | keyof AgentParams
  | "conversation.read"
  | "session.list"
  | "session.history"
  | "approval.answer"
  | "approval.cancel"
  | "session.mode"
  | "session.prompt"
  | "session.interrupt";

export type RequestMessage =
  | CommandRequest
  | {
      type: "request";
      op_id: string;
      action: "conversation.read";
      params: { target: string; through_revision: number; completion_key: string };
    }
  | AgentRequest
  | { type: "request"; op_id: string; action: "session.list"; params: Record<string, never> }
  | {
      type: "request";
      op_id: string;
      action: "session.history";
      params: { session_id: string; cursor: string | null; limit: number };
    }
  | { type: "request"; op_id: string; action: "approval.answer"; params: ApprovalAnswerParams }
  | { type: "request"; op_id: string; action: "approval.cancel"; params: ApprovalCancelParams }
  | { type: "request"; op_id: string; action: "session.mode"; params: SessionModeParams }
  | { type: "request"; op_id: string; action: "session.prompt"; params: SessionPromptParams }
  | { type: "request"; op_id: string; action: "session.interrupt"; params: SessionInterruptParams };

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PongMessage | RequestMessage;

export type ApprovalAnswerResult = {
  approval_id: string;
  status: ApprovalStatus;
};

export type ApprovalCancelResult = {
  approval_id: string;
  status: ApprovalStatus;
};

export type SessionModeResult = {
  session_id: string;
  mode: string;
  outcome: AppliedMode;
};

export type SessionPromptResult = {
  session_id: string;
  state: PromptDeliveryState;
  code: string | null;
};

export type SessionInterruptResult = {
  session_id: string;
  interrupted: boolean;
};

export type ActionResultMap = CommandResults &
  AgentResults & {
    "conversation.read": ConversationStatus;
    "session.list": { sessions: import("./rest.gen").components["schemas"]["SessionOut"][] };
    "session.history": {
      completion_revision?: number | null;
      completion_target?: string | null;
      entries: string[];
      next_cursor: string | null;
      has_more: boolean;
      turn_active?: boolean | null;
      external_busy?: boolean | null;
      external_model?: string | null;
    };
    "approval.answer": ApprovalAnswerResult;
    "approval.cancel": ApprovalCancelResult;
    "session.mode": SessionModeResult;
    "session.prompt": SessionPromptResult;
    "session.interrupt": SessionInterruptResult;
  };

export interface SubscribedMessage {
  op: "subscribed";
  topic: WsTopic;
  from_seq: number;
}

export interface UnsubscribedMessage {
  op: "unsubscribed";
  topic: WsTopic;
}

export interface SnapshotMessage {
  type: "snapshot";
  topic: "sessions.all";
  sessions: SnapshotSession[];
  statuses?: ConversationStatus[];
  runtimes: RuntimeStatus[];
}

export interface EventMessage {
  agent_id?: string | null;
  topic: WsTopic;
  seq: number;
  source: EventSource;
  raw: unknown;
  ts: number;
}

export type DegradationMessage = EventMessage & {
  source: "mandri";
  raw: DegradationPayload;
};

export interface ApprovalPendingMessage {
  kind?:
    | "command_execution"
    | "file_change"
    | "permission_scope"
    | "user_input"
    | "elicitation"
    | "unknown";
  permission_modes?: string[];
  agent_id?: string | null;
  type: "approval.pending";
  topic: WsTopic;
  seq: number;
  source: HarnessKind;
  raw: unknown;
  ts: number;
  approval_id: string;
  deadline: number;
  status: ApprovalStatus;
}

export interface ApprovalResolvedMessage {
  type: "approval.resolved";
  topic: WsTopic;
  seq: number;
  source: "mandri";
  raw: unknown;
  ts: number;
  approval_id: string;
  outcome: ResolvedApprovalStatus;
  decision?: ApprovalDecision | null;
}

export interface SessionStoppedMessage {
  type: "session_stopped";
  topic: WsTopic;
  seq: number;
  source: "mandri";
  raw: {
    session_id: string;
    harness: HarnessKind;
    state: "stopped";
    cause: SessionStopCause;
  };
  ts: number;
}

export interface ControlLostMessage {
  type: "control_lost";
  topic: WsTopic;
  seq: number;
  source: "mandri";
  raw: {
    session_id: string;
    harness: HarnessKind;
  };
  ts: number;
}

export interface InteractionModeMessage {
  type: "interaction_mode";
  topic: WsTopic;
  seq: number;
  source: "mandri";
  raw: { session_id: string; harness: HarnessKind; mode: string; applied: string };
  ts: number;
}

export interface GapMessage {
  type: "gap";
  topic: WsTopic;
  from_seq: number;
  seq: number;
  reason: GapReason;
}

export interface PingMessage {
  type: "ping";
}

export interface ErrorMessage {
  type: "error";
  detail: string;
}

export interface ResponseError {
  code: string;
  message: string;
}

export type ResponseMessage =
  | { type: "response"; op_id: string; ok: true; result: Record<string, unknown>; error: null }
  | { type: "response"; op_id: string; ok: false; result: null; error: ResponseError };

export type ServerMessage =
  | SubscribedMessage
  | UnsubscribedMessage
  | SnapshotMessage
  | {
      type: "conversation_status";
      topic: "conversations.all";
      seq: number;
      status: ConversationStatus;
    }
  | EventMessage
  | DegradationMessage
  | ApprovalPendingMessage
  | ApprovalResolvedMessage
  | SessionStoppedMessage
  | ControlLostMessage
  | InteractionModeMessage
  | GapMessage
  | PingMessage
  | ErrorMessage
  | ResponseMessage;
import type { AgentParams, AgentRequest, AgentResults } from "./agents";
