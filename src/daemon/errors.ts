const DAEMON_ERROR_CODES = [
  "not_found",
  "service_unavailable",
  "validation_error",
  "session_not_found",
  "session_conflict",
  "session_owned_externally",
  "session_running",
  "session_not_running",
  "session_not_resumable",
  "harness_not_installed",
  "harness_store_unavailable",
  "attachment_storage_unavailable",
  "history_cursor_invalid",
  "provider_not_found",
  "provider_exists",
  "provider_invalid",
  "provider_verification_failed",
  "provider_in_use",
  "provider_models_failed",
  "fs_not_found",
  "fs_not_a_directory",
  "fs_read_error",
  "route_invalid",
  "route_not_found",
  "model_metadata_unavailable",
  "unknown_action",
  "approval_not_pending",
  "approval_already_answered",
  "approval_expired",
  "steer_unsupported",
  "steer_no_active_turn",
  "mode_requires_restart",
  "mode_rejected",
  "invalid_effort",
  "prompt_delivery_failed",
  "control_delivery_failed",
  "delivery_unknown",
  "internal_error",
  "agent_unsupported",
  "native_restore_failed",
  "invalid_params",
  "duplicate_op_id",
  "docker_unavailable",
  "docker_security_setup_required",
  "docker_network_unavailable",
  "docker_native_unsupported",
  "docker_image_missing",
  "docker_image_reference_invalid",
  "docker_image_pull_timeout",
  "docker_image_pull_failed",
  "docker_operation_timed_out",
  "docker_image_incompatible",
  "docker_resource_limit_invalid",
  "workspace_unavailable",
  "workspace_identity_changed",
  "native_state_incompatible",
  "native_initialization_timeout",
  "privacy_platform_unsupported",
  "privacy_key_unavailable",
  "privacy_state_unavailable",
  "session_transition_unsupported",
  "privacy_native_unsupported",
  "protection_capabilities_unavailable",
  "session_policy_unconfirmed",
  "session_policy_conflict",
  "execution_status_unavailable",
  "operation_cancelled",
  "worktree_invalid_id",
  "worktree_repository_required",
  "worktree_docker_incompatible",
  "worktree_unavailable",
  "worktree_missing",
  "worktree_has_changes",
  "worktree_closed",
  "worktree_git_busy",
  "worktree_submodule_changes",
  "worktree_invalid_target",
  "worktree_target_changed",
  "worktree_preview_changed",
  "worktree_commit_message",
  "worktree_conflicts",
  "worktree_target_dirty",
  "worktree_no_changes",
  "unknown",
] as const;

export type DaemonErrorCode = (typeof DAEMON_ERROR_CODES)[number];

export const DAEMON_ERROR_I18N_KEYS: Record<string, string> = Object.fromEntries(
  DAEMON_ERROR_CODES.map((code) => [code, `error.${code}`] as const),
);

export function daemonErrorKey(error: unknown): string {
  return error instanceof DaemonError
    ? (DAEMON_ERROR_I18N_KEYS[error.code] ?? "error.unknown")
    : "error.unknown";
}

export class DaemonError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown>;
  readonly httpStatus: number | undefined;

  constructor(params: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
    httpStatus?: number;
  }) {
    super(params.message);
    this.name = "DaemonError";
    this.code = params.code;
    this.detail = params.detail ?? {};
    this.httpStatus = params.httpStatus;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseErrorResponse(httpStatus: number, body: unknown): DaemonError {
  const envelope = asRecord(asRecord(body)?.["error"]);
  const code = nonEmptyString(envelope?.["code"]) ?? "unknown";
  const message = nonEmptyString(envelope?.["message"]) ?? "";
  const detail = asRecord(envelope?.["detail"]) ?? {};
  return new DaemonError({ code, message, detail, httpStatus });
}
