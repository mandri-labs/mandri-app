import type { AgentView } from "@/daemon/types/agents";
import type { HarnessKind } from "@/daemon/types/ws";
import type { SessionView } from "@/stores/sessions";

export const teamSessions: SessionView[] = [
  {
    id: "team",
    harness: "claude",
    state: "live",
    deleted: false,
    title: "Ship the authentication update",
    projectPath: "/workspace/atlas",
    model: "native:claude/sonnet",
    pendingApprovals: 0,
    lastActivityAt: 400,
    nativeTurnActive: false,
  },
  {
    id: "tests",
    harness: "opencode",
    state: "live",
    deleted: false,
    title: "Verify the release candidate",
    projectPath: "/workspace/beacon",
    model: "native:opencode/default",
    pendingApprovals: 0,
    lastActivityAt: 300,
    nativeTurnActive: false,
  },
];

export const teamAgents: AgentView[] = [
  {
    id: "implementation",
    harness: "codex",
    parent_session_id: "team",
    parent_agent_id: null,
    session_id: null,
    native_id: "implementation-native",
    title: "Implement token rotation",
    state: "running",
    delegation_id: "rotation",
    task_id: "/root/implementation",
    capabilities: { message: true, stop: true },
    created_at: 1,
    updated_at: 4,
  },
  {
    id: "review",
    harness: "claude",
    parent_session_id: "team",
    parent_agent_id: null,
    session_id: null,
    native_id: "review-native",
    title: "Review the security boundary",
    state: "completed",
    delegation_id: "review",
    capabilities: { message: false, stop: false },
    created_at: 2,
    updated_at: 3,
  },
  {
    id: "migration",
    harness: "opencode",
    parent_session_id: "team",
    parent_agent_id: "implementation",
    session_id: null,
    native_id: "migration-native",
    title: "Validate the migration",
    state: "waiting",
    delegation_id: "migration",
    capabilities: { message: true, stop: true },
    created_at: 3,
    updated_at: 4,
  },
];

const conversations: Record<string, readonly [string, string][]> = {
  team: [
    [
      "user",
      "Prepare the authentication update. Delegate the implementation, review the security boundary, and verify the migration before release.",
    ],
    [
      "assistant",
      "The work is split into three focused tasks.\n\n| Agent | Responsibility | Progress |\n| --- | --- | --- |\n| Implementation | Rotate refresh tokens | In progress |\n| Security review | Check session isolation | Reviewed |\n| Migration | Verify the database change | Needs approval |\n\nThe review found no cross-session access. I’m waiting for the migration check before collecting the final changes.",
    ],
  ],
  tests: [
    ["user", "Check the release candidate against the authentication flows."],
    [
      "assistant",
      "The release checks are complete.\n\n- Sign-in and sign-out pass.\n- Expired tokens are rejected.\n- Concurrent refresh requests preserve a single valid token.\n\n**Next:** run the migration smoke test after the approval is resolved.",
    ],
  ],
  implementation: [
    ["user", "Implement refresh-token rotation. Preserve the existing sign-in flow."],
    [
      "assistant",
      "The rotation handler is in place. Refresh requests now invalidate the previous token atomically.\n\nI’m checking the retry path and coordinating the migration validation before marking this task complete.",
    ],
  ],
  review: [
    ["user", "Review the security boundary around refresh-token rotation."],
    [
      "assistant",
      "The security review is complete.\n\n1. Tokens are scoped to their original session.\n2. Revoked tokens cannot be reused.\n3. The update does not broaden the session’s permissions.\n\n**Recommendation:** include the concurrent-refresh regression in the release checks.",
    ],
  ],
  migration: [
    ["user", "Validate the migration against the synthetic test database."],
    [
      "assistant",
      "The schema check passed. The migration adds the token version without changing existing session ownership.\n\nI need approval to run the local migration smoke test. No production database is involved.",
    ],
  ],
};

export function storyHistory(
  harness: HarnessKind,
  id: string,
  messages = conversations[id] ?? [],
): string[] {
  return messages.flatMap(([role, text], index) => {
    const key = `${id}-${index}`;
    if (harness === "codex")
      return [
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            id: key,
            role,
            content: [{ type: role === "user" ? "input_text" : "output_text", text }],
          },
        }),
      ];
    if (harness === "opencode")
      return [
        JSON.stringify({ type: "message.updated", properties: { info: { id: key, role } } }),
        JSON.stringify({
          type: "message.part.updated",
          properties: { part: { id: `${key}-part`, messageID: key, type: "text", text } },
        }),
      ];
    return [
      JSON.stringify({
        type: role,
        uuid: key,
        message: { id: key, role, content: [{ type: "text", text }] },
      }),
    ];
  });
}
