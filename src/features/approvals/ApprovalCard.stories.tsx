import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApprovalCard } from "./ApprovalCard";
import type { ApprovalCardProps } from "./ApprovalCard";
import type { ApprovalView } from "@/stores/approvals";

void import("@/i18n").then(({ initI18n }) => initI18n("en"));

const NOW = Date.now();

const claudeCommandRaw = {
  type: "control_request",
  request_id: "e88ef9fc-0cf2-4897-a44f-264998f14119",
  request: {
    subtype: "can_use_tool",
    tool_name: "Bash",
    display_name: "Bash",
    input: { command: "git --version", description: "Show git version" },
    description: "Show git version",
    decision_reason: "This command requires approval",
    tool_use_id: "call-edd9ad48",
  },
};

const claudeFileRaw = {
  type: "control_request",
  request_id: "req-file-1",
  request: {
    subtype: "can_use_tool",
    tool_name: "Edit",
    display_name: "Edit",
    input: { file_path: "D:/Projects/example-app/src/app/main.ts", old_string: "const a = 1;" },
    description: "Edit main.ts",
  },
};

const claudeScopeRaw = {
  type: "control_request",
  request_id: "req-scope-1",
  request: {
    subtype: "can_use_tool",
    tool_name: "WebFetch",
    display_name: "WebFetch",
    input: { url: "https://example.com" },
    permission_suggestions: [
      {
        type: "addRules",
        rules: [{ toolName: "WebFetch", ruleContent: "WebFetch(domain:example.com)" }],
        behavior: "allow",
        destination: "localSettings",
      },
    ],
  },
};

const claudeQuestionRaw = {
  type: "control_request",
  request_id: "req-question-1",
  request: {
    subtype: "can_use_tool",
    tool_name: "AskUserQuestion",
    display_name: "AskUserQuestion",
    input: {
      questions: [{ question: "Should the migration run now or during the next deploy window?" }],
    },
  },
};

const claudeMcpRaw = {
  type: "control_request",
  request_id: "req-mcp-1",
  request: {
    subtype: "can_use_tool",
    tool_name: "mcp__plugin_playwright__browser_navigate",
    display_name: "browser_navigate",
    input: { url: "https://example.com" },
  },
};

const codexCommandRaw = {
  method: "execApproval/request",
  params: { command: ["npm", "run", "test"], cwd: "D:/Projects/example-app" },
};

const codexPatchRaw = {
  method: "applyPatchApproval/request",
  params: {
    patch: "*** Begin Patch\n*** Update File: src/main.ts\n*** End Patch",
    reason: "apply patch",
  },
};

const opencodeCommandRaw = {
  id: "evt-1",
  type: "permission.asked",
  properties: {
    id: "per-1",
    sessionID: "ses-1",
    permission: "bash",
    patterns: ["git --version"],
    metadata: { command: "git --version" },
    always: ["git --version *"],
  },
};

const opencodeScopeRaw = {
  id: "evt-2",
  type: "permission.asked",
  properties: {
    id: "per-2",
    sessionID: "ses-1",
    permission: "edit",
    patterns: ["src/**", "tests/**"],
  },
};

function view(
  overrides: Partial<ApprovalView> & {
    approvalId: string;
    raw: unknown;
    harness: ApprovalView["harness"];
  },
): ApprovalView {
  return {
    sessionId: "session-1",
    kind: "command_execution",
    deadline: NOW + 120_000,
    status: "pending",
    ...overrides,
  };
}

function QuestionDemo({ approval, ...props }: ApprovalCardProps) {
  const [current, setCurrent] = useState(approval);
  return (
    <ApprovalCard
      {...props}
      approval={current}
      onAnswer={(decision) => setCurrent((value) => ({ ...value, status: "answered", decision }))}
      onCancel={() => setCurrent((value) => ({ ...value, status: "cancelled" }))}
    />
  );
}

const meta = {
  title: "Features/Approvals/ApprovalCard",
  component: ApprovalCard,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClaudeCommand: Story = {
  args: {
    approval: view({ approvalId: "cl-cmd", harness: "claude", raw: claudeCommandRaw }),
  },
};

export const ClaudeFileChange: Story = {
  args: {
    approval: view({
      approvalId: "cl-file",
      harness: "claude",
      raw: claudeFileRaw,
      kind: "file_change",
    }),
  },
};

export const ClaudePermissionScope: Story = {
  args: {
    approval: view({
      approvalId: "cl-scope",
      harness: "claude",
      raw: claudeScopeRaw,
      kind: "permission_scope",
    }),
  },
};

export const ClaudeUserInput: Story = {
  render: (args) => <QuestionDemo {...args} />,
  args: {
    approval: view({
      approvalId: "cl-question",
      harness: "claude",
      raw: claudeQuestionRaw,
      kind: "user_input",
    }),
  },
};

export const ClaudeElicitation: Story = {
  args: {
    approval: view({
      approvalId: "cl-mcp",
      harness: "claude",
      raw: claudeMcpRaw,
      kind: "elicitation",
    }),
  },
};

export const CodexCommand: Story = {
  args: {
    approval: view({
      approvalId: "cx-cmd",
      harness: "codex",
      raw: codexCommandRaw,
      sessionId: "session-2",
    }),
  },
};

export const CodexFileChange: Story = {
  args: {
    approval: view({
      approvalId: "cx-patch",
      harness: "codex",
      raw: codexPatchRaw,
      kind: "file_change",
      sessionId: "session-2",
    }),
  },
};

export const OpencodeCommand: Story = {
  args: {
    approval: view({
      approvalId: "oc-cmd",
      harness: "opencode",
      raw: opencodeCommandRaw,
      sessionId: "session-3",
    }),
  },
};

export const OpencodePermissionScope: Story = {
  args: {
    approval: view({
      approvalId: "oc-scope",
      harness: "opencode",
      raw: opencodeScopeRaw,
      kind: "permission_scope",
      sessionId: "session-3",
    }),
  },
};

export const UnknownKind: Story = {
  args: {
    approval: view({
      approvalId: "unknown-1",
      harness: "codex",
      raw: { method: "mystery/request", params: { hint: "unrecognized payload" } },
      kind: "unknown",
    }),
  },
};

export const CountdownUrgent: Story = {
  args: {
    approval: view({
      approvalId: "urgent-1",
      harness: "claude",
      raw: claudeCommandRaw,
      deadline: NOW + 9_000,
    }),
  },
};

export const ExpiredState: Story = {
  args: {
    approval: view({
      approvalId: "expired-1",
      harness: "claude",
      raw: claudeCommandRaw,
      status: "expired",
      deadline: NOW - 1_000,
    }),
  },
};

export const CancelledState: Story = {
  args: {
    approval: view({
      approvalId: "cancelled-1",
      harness: "opencode",
      raw: opencodeCommandRaw,
      status: "cancelled",
      sessionId: "session-3",
    }),
  },
};

export const AnsweredClaude: Story = {
  args: {
    approval: view({
      approvalId: "answered-1",
      harness: "claude",
      raw: claudeCommandRaw,
      status: "answered",
      decision: "allow",
    }),
  },
};

export const AnsweredCodex: Story = {
  args: {
    approval: view({
      approvalId: "answered-2",
      harness: "codex",
      raw: codexCommandRaw,
      status: "answered",
      decision: "acceptForSession",
      sessionId: "session-2",
    }),
  },
};

export const ErrorState: Story = {
  args: {
    approval: view({
      approvalId: "error-1",
      harness: "claude",
      raw: claudeCommandRaw,
      status: "answered",
      decision: "deny",
    }),
  },
  decorators: [
    (Story: () => React.ReactNode) => {
      void import("@/stores/approvals").then(({ approvalsStore }) => {
        approvalsStore.setState((state) => ({
          errors: { ...state.errors, "error-1": "approval_already_answered" },
        }));
      });
      return <Story />;
    },
  ],
};

export const MiniVariant: Story = {
  args: {
    approval: view({
      approvalId: "mini-1",
      harness: "claude",
      raw: claudeCommandRaw,
    }),
    variant: "mini",
  },
};

export const OpencodeMultipleQuestions: Story = {
  render: (args) => <QuestionDemo {...args} />,
  args: {
    approval: view({
      approvalId: "oc-questions",
      harness: "opencode",
      kind: "user_input",
      raw: {
        type: "question.asked",
        properties: {
          id: "q-1",
          sessionID: "ses-1",
          questions: [
            {
              header: "Destination",
              question: "Where should the command publish its report?",
              custom: false,
              options: [
                { label: "Workspace", description: "Keep it alongside the project" },
                { label: "Temporary folder", description: "Discard it after review" },
              ],
            },
            {
              header: "Validation",
              question: "Which checks should run?",
              multiple: true,
              options: [
                { label: "Unit tests", description: "Fast checks for isolated behavior" },
                { label: "Integration tests", description: "Check the connected components" },
              ],
            },
          ],
        },
      },
    }),
    onAnswer: () => undefined,
    onCancel: () => undefined,
  },
};

export const CodexStructuredQuestion: Story = {
  render: (args) => <QuestionDemo {...args} />,
  args: {
    approval: view({
      approvalId: "cx-question",
      harness: "codex",
      kind: "user_input",
      raw: {
        method: "item/tool/requestUserInput",
        params: {
          questions: [
            {
              id: "strategy",
              header: "Strategy",
              question: "How should existing files be handled?",
              isOther: true,
              options: [
                { label: "Merge", description: "Preserve existing content" },
                { label: "Replace", description: "Use the new version" },
              ],
            },
          ],
        },
      },
    }),
    onAnswer: () => undefined,
    onCancel: () => undefined,
  },
};

export const UnsupportedQuestion: Story = {
  render: (args) => <QuestionDemo {...args} />,
  args: {
    approval: view({
      approvalId: "unsupported-question",
      harness: "codex",
      kind: "user_input",
      raw: { params: {} },
    }),
    onCancel: () => undefined,
  },
};
