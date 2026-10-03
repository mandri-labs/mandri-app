export type ExecutionBackend = "host" | "docker";
export type PrivacyMode = "none" | "surrogate";
export type ProtectionChoice =
  "standard" | "surrogate" | "docker" | "paranoid" | "worktree" | "worktree_surrogate";

export interface WorktreeInfo {
  id: string;
  path: string;
  source_path: string;
  repository: string;
  state?: string;
  integrated_target?: string | null;
  integrated_commit?: string | null;
}

export interface SessionPolicy {
  worktree?: WorktreeInfo;
  executionBackend?: ExecutionBackend;
  privacyMode?: PrivacyMode;
  policyRevision?: number;
  policyConfirmed?: boolean;
  executionGeneration?: number;
  executionRevision?: number;
  executionPhase?: string;
  executionReason?: string;
  effectiveBinding?: boolean;
}

export interface PolicyRequest {
  worktree?: boolean;
  worktree_id?: string;
  execution_backend: ExecutionBackend;
  privacy_mode: PrivacyMode;
}

export const PROTECTION_CHOICES: readonly ProtectionChoice[] = [
  "standard",
  "surrogate",
  "docker",
  "paranoid",
  "worktree",
  "worktree_surrogate",
];

export function choicePolicy(choice: ProtectionChoice): PolicyRequest {
  return {
    execution_backend: choice === "docker" || choice === "paranoid" ? "docker" : "host",
    privacy_mode:
      choice === "surrogate" || choice === "paranoid" || choice === "worktree_surrogate"
        ? "surrogate"
        : "none",
    ...(choice === "worktree" || choice === "worktree_surrogate" ? { worktree: true } : {}),
  };
}

export function policyChoice(policy: SessionPolicy): ProtectionChoice {
  if (policy.worktree)
    return policy.privacyMode === "surrogate" ? "worktree_surrogate" : "worktree";
  if (policy.executionBackend === "docker")
    return policy.privacyMode === "surrogate" ? "paranoid" : "docker";
  return policy.privacyMode === "surrogate" ? "surrogate" : "standard";
}

export function policyFromWire(raw: unknown, previous: SessionPolicy = {}): SessionPolicy {
  previous = {
    worktree: previous.worktree,
    executionBackend: previous.executionBackend,
    privacyMode: previous.privacyMode,
    policyRevision: previous.policyRevision,
    policyConfirmed: previous.policyConfirmed,
    executionGeneration: previous.executionGeneration,
    executionPhase: previous.executionPhase,
    executionRevision: previous.executionRevision,
    executionReason: previous.executionReason,
    effectiveBinding: previous.effectiveBinding,
  };
  if (!raw || typeof raw !== "object") return previous;
  const value = raw as Record<string, unknown>;
  const execution = value.execution_backend;
  const privacy = value.privacy_mode;
  const revision = value.policy_revision;
  if (
    (execution !== "host" && execution !== "docker") ||
    (privacy !== "none" && privacy !== "surrogate") ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    return previous;
  if (revision < (previous.policyRevision ?? 0)) return previous;
  if (
    previous.policyConfirmed &&
    (previous.executionBackend !== execution ||
      (previous.privacyMode !== privacy && revision === previous.policyRevision))
  ) {
    return { ...previous, executionReason: "session_policy_conflict", effectiveBinding: false };
  }
  return {
    ...previous,
    worktree:
      value.worktree === null
        ? undefined
        : value.worktree &&
            typeof value.worktree === "object" &&
            typeof (value.worktree as WorktreeInfo).id === "string"
          ? (value.worktree as WorktreeInfo)
          : previous.worktree,
    executionBackend: execution,
    privacyMode: privacy,
    policyRevision: revision,
    policyConfirmed: true,
  };
}

export function permitsNative(policy: SessionPolicy): boolean {
  return policy.privacyMode !== "surrogate" && policy.executionBackend !== "docker";
}

export function permitsModel(model: string, policy: SessionPolicy): boolean {
  return !model.startsWith("native:") || permitsNative(policy);
}
