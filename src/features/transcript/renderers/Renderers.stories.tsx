import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TranscriptNode } from "../parse/types";
import { AssistantText, type AssistantTextProps } from "./AssistantText";
import { DiffCard, type DiffCardProps, type DiffLine } from "./DiffCard";
import { PlanSteps, type PlanStep, type PlanStepsProps } from "./PlanSteps";
import { RawNode, type RawNodeProps } from "./RawNode";
import { SystemBanner, type SystemBannerLevel, type SystemBannerProps } from "./SystemBanner";
import { ThinkingLine, type ThinkingLineProps } from "./ThinkingLine";
import { ToolLine, type ToolLineProps } from "./ToolLine";
import { TranscriptNodeRenderer } from "./TranscriptNodeRenderer";
import { UserBubble, type UserBubbleProps } from "./UserBubble";

const meta = {
  title: "Features/Transcript/Renderers",
} satisfies Meta;

export default meta;

const sampleLines: DiffLine[] = [
  {
    type: "context",
    text: "export function refreshSession(token: string) {",
    oldNo: 41,
    newNo: 41,
  },
  {
    type: "del",
    text: "  return legacyRefresh(token);",
    oldNo: 42,
  },
  {
    type: "add",
    text: "  return rotateToken(token, { ttlSeconds: 3600 });",
    newNo: 42,
  },
  {
    type: "add",
    text: "  auditLog.record(\"session.refresh\", { ttlSeconds: 3600 });",
    newNo: 43,
  },
  { type: "context", text: "}", oldNo: 43, newNo: 44 },
];

const sampleSteps: PlanStep[] = [
  { text: "Locate session token helpers", status: "done" },
  { text: "Rotate token on refresh with TTL", status: "running" },
  { text: "Add regression tests", status: "waiting" },
];

export const UserBubbleDefault: StoryObj<UserBubbleProps> = {
  args: { text: "Refactor the auth module and add regression tests for token rotation." },
  render: (props) => <UserBubble {...props} />,
};

export const AssistantTextDefault: StoryObj<AssistantTextProps> = {
  args: {
    text: "I refactored the session token path.\nRotated tokens now carry a TTL and every refresh is written to the audit log.",
  },
  render: (props) => <AssistantText {...props} />,
};

export const AssistantTextStreaming: StoryObj<AssistantTextProps> = {
  args: {
    text: "Rotated tokens now carry a TTL and every refresh is",
    streaming: true,
  },
  render: (props) => <AssistantText {...props} />,
};

export const ThinkingLineDefault: StoryObj<ThinkingLineProps> = {
  args: { text: "Locate the session token helpers before touching the login flow" },
  render: (props) => <ThinkingLine {...props} />,
};

export const ToolLineRunning: StoryObj<ToolLineProps> = {
  args: { tool: "Search", label: "Searching", target: "src/auth/", status: "running" },
  render: (props) => <ToolLine {...props} />,
};

export const ToolLineDone: StoryObj<ToolLineProps> = {
  args: {
    tool: "Edit",
    label: "Edited",
    target: "src/auth/session.ts",
    status: "done",
    durationMs: 13000,
    additions: 12,
    deletions: 3,
    detailText: "Applied 2 edits to src/auth/session.ts\n- replaced legacyRefresh call\n- added audit log record",
  },
  render: (props) => <ToolLine {...props} />,
};

export const ToolLineFailed: StoryObj<ToolLineProps> = {
  args: {
    tool: "Bash",
    label: "Command failed",
    target: "npm test -- auth",
    status: "failed",
    durationMs: 4200,
  },
  render: (props) => <ToolLine {...props} />,
};

export const ToolLineGit: StoryObj<ToolLineProps> = {
  args: {
    tool: "Git",
    label: "Committed",
    target: "a1b2c3d",
    status: "done",
    durationMs: 900,
  },
  render: (props) => <ToolLine {...props} />,
};

export const DiffCardDefault: StoryObj<DiffCardProps> = {
  args: {
    path: "src/auth/session.ts",
    additions: 12,
    deletions: 3,
    lines: sampleLines,
  },
  render: (props) => <DiffCard {...props} />,
};

export const DiffCardNoLines: StoryObj<DiffCardProps> = {
  args: {
    path: "src/auth/token.ts",
    additions: 0,
    deletions: 0,
  },
  render: (props) => <DiffCard {...props} />,
};

export const PlanStepsDefault: StoryObj<PlanStepsProps> = {
  args: { steps: sampleSteps },
  render: (props) => <PlanSteps {...props} />,
};

export const SystemBannerError: StoryObj<SystemBannerProps> = {
  args: {
    level: "error" satisfies SystemBannerLevel,
    text: "Daemon connection lost, retrying in 5s",
  },
  render: (props) => <SystemBanner {...props} />,
};

export const SystemBannerWarning: StoryObj<SystemBannerProps> = {
  args: {
    level: "warning" satisfies SystemBannerLevel,
    text: "Harness session degraded, output may be incomplete",
  },
  render: (props) => <SystemBanner {...props} />,
};

export const SystemBannerInfo: StoryObj<SystemBannerProps> = {
  args: {
    level: "info" satisfies SystemBannerLevel,
    text: "Session resumed from history snapshot",
  },
  render: (props) => <SystemBanner {...props} />,
};

export const RawNodeDefault: StoryObj<RawNodeProps> = {
  args: {
    harness: "claude",
    summary: "Unsupported event",
    payload: {
      event: "tool.progress",
      seq: 1287,
      detail: { units: 3, kind: "chunks" },
    },
  },
  render: (props) => <RawNode {...props} />,
};

const compositeNodes: TranscriptNode[] = [
  { kind: "user", text: "Refactor the auth module and add regression tests." },
  {
    kind: "thinking",
    text: "Locate the session token helpers before touching the login flow",
  },
  { kind: "tool", tool: "Search", label: "Searching", target: "src/auth/", status: "running" },
  {
    kind: "tool",
    tool: "Edit",
    label: "Edited",
    target: "session.ts",
    status: "done",
    durationMs: 13000,
    additions: 12,
    deletions: 3,
  },
  {
    kind: "diff",
    path: "src/auth/session.ts",
    additions: 12,
    deletions: 3,
    lines: sampleLines,
  },
  {
    kind: "plan",
    steps: sampleSteps,
  },
  {
    kind: "assistant",
    text: "Refactored the token refresh path: rotated tokens carry a TTL and every refresh lands in the audit log.",
  },
  {
    kind: "system",
    level: "error",
    text: "Harness exited unexpectedly, transcript may be incomplete",
  },
  {
    kind: "raw",
    harness: "codex",
    payload: { event: "task.status", seq: 412, detail: { state: "interrupted" } },
  },
];

export const Composite: StoryObj = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      {compositeNodes.map((node, index) => (
        <TranscriptNodeRenderer key={index} node={node} />
      ))}
    </div>
  ),
};
