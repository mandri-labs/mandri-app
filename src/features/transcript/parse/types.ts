export type TranscriptToolStatus = "pending" | "running" | "waiting" | "done" | "failed" | "cancelled";

export type TranscriptDiffLineType = "add" | "del" | "context";

export interface TranscriptDiffLine {
  type: TranscriptDiffLineType;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export type TranscriptPlanStepStatus = "done" | "running" | "waiting" | "cancelled";

export interface TranscriptPlanStep {
  text: string;
  status: TranscriptPlanStepStatus;
}

export interface ClaudeBlockIdentity {
  messageId: string;
  blockId?: string;
  blockIndex?: number;
}

export interface AsyncQuestion {
  title: string;
  options: string[];
}

export type ActivityKind = "read" | "search" | "list" | "edit" | "command" | "web" | "tool";

export interface ToolAction {
  kind: ActivityKind;
  target?: string;
  query?: string;
}

export interface NativeToolIdentity {
  callId?: string;
  messageId?: string;
  partId?: string;
  parentCallId?: string;
  sessionId?: string;
  turnId?: string;
  startedAt?: number;
  metadata?: unknown;
  attachments?: unknown;
  subagents?: unknown;
}

export type TranscriptDiff = Extract<TranscriptNode, { kind: "diff" }>;

export type TranscriptNode =
  | { kind: "record"; preview?: string; byteLength: number; key?: string; eventKind?: "compaction" | "command" | "file_change" }
  | { kind: "user"; text: string; codexUser?: { turnId: string; itemId?: string }; messageId?: string; images?: import("./images").TranscriptImage[]; key?: string;
      // Keep local DOM identity and decoded previews separate from native content.
      localPresentation?: { key: string; images?: import("./images").TranscriptImage[] } }
  | { kind: "assistant"; questions?: AsyncQuestion[]; claude?: ClaudeBlockIdentity; text: string; streaming?: boolean; delta?: boolean; key?: string }
  | { kind: "thinking"; claude?: ClaudeBlockIdentity; text: string; summary?: string; streaming?: boolean; delta?: boolean; key?: string }
  | {
      kind: "tool";
      tool: string;
      label: string;
      target?: string;
      title?: string;
      actions?: ToolAction[];
      actionSource?: "native" | "fallback";
      native?: NativeToolIdentity;
      update?: boolean;
      status: TranscriptToolStatus;
      durationMs?: number;
      detailText?: string;
      details?: { input?: unknown; output?: unknown };
      codex?: { input?: unknown; output?: unknown; outputDelta?: boolean };
      additions?: number;
      deletions?: number;
      path?: string;
      key?: string;
    }
  | {
      kind: "diff";
      path: string;
      change?: "add" | "update" | "delete";
      oldPath?: string;
      callId?: string;
      additions: number;
      deletions: number;
      lines?: TranscriptDiffLine[];
      key?: string;
    }
  | {
      kind: "plan";
      steps: TranscriptPlanStep[];
      key?: string;
    }
  | {
      kind: "system";
      key?: string;
      level: "info" | "warning" | "error";
      text: string;
      messageKey?: string;
      values?: Record<string, string | number>;
    }
  | { kind: "activity_summary"; text: string; callIds: string[]; parentCallId?: string; key?: string }
  | { kind: "file_snapshot"; files: TranscriptDiff[]; scope: "turn" | "session"; turnId?: string; key?: string }
  | { kind: "raw"; harness: string; payload: unknown; key?: string };

export interface ParseContext {
  piStream?: import("./pi").PiStreamState;
  claudeStream?: import("./claudeStream").ClaudeStreamState;
  sessionId?: string;
  agyToolCalls?: ReadonlyMap<number, Record<string, unknown>>;
  agyTaskResults?: ReadonlyMap<number, { noticeIndex: number; output: string; exitCode: number }>;
  messageRoles?: ReadonlyMap<string, "user" | "assistant">;
  partKinds?: ReadonlyMap<string, "text" | "reasoning">;
}
