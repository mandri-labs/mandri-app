import { modelSelection } from "@/daemon/modelSelection";
import {
  permitsModel,
  permitsNative,
  policyFromWire,
  type PolicyRequest,
} from "@/daemon/protection";
import type { components } from "@/daemon/types/rest.gen";
import type { HarnessKind } from "@/daemon/types/ws";
import { DaemonError, daemonErrorKey } from "@/daemon/errors";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import {
  deleteSession as deleteSessionRest,
  getSession,
  renameSession as renameSessionRest,
} from "@/daemon/rest/sessions";
import {
  resumeSession as resumeSessionRest,
  startSession as startSessionRest,
  stopSession as stopSessionRest,
} from "@/daemon/rest/runtime";
import { panesStore } from "@/stores/panes";
import { sessionsStore, stoppedPatch, transcriptStore } from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";
import { createDebugLogger } from "@/lib/debug";
import { restoreNativeModel } from "@/daemon/rest/availability";
import { applyAvailability, invalidateAvailability, refreshAvailability } from "./availability";
import { queueSessionModelChange } from "@/features/providers/sessionModelQueue";
import { daemonIdentity } from "@/daemon/identity";
import { invalidateSessionMetadata } from "@/app/sessionSync";

const log = createDebugLogger("sessionLifecycle");

type RuntimeSessionOut = components["schemas"]["RuntimeSessionOut"];
type RuntimeStartIn = components["schemas"]["RuntimeStartIn"];

export interface SessionStartInput {
  harness: string;
  model: string;
  cwd: string;
  mode?: string | null;
  effort?: string | null;
  execution_backend?: PolicyRequest["execution_backend"];
  privacy_mode?: PolicyRequest["privacy_mode"];
  operation_id?: string;
  worktree?: boolean;
  worktree_id?: string;
}

export type ResumabilityReason = "state" | "origin";

export interface Resumability {
  resumable: boolean;
  reason: ResumabilityReason | null;
}

const HARNESS_KINDS: readonly string[] = ["claude", "codex", "opencode", "agy", "pi"];

export function errorKey(error: unknown): string {
  return daemonErrorKey(error);
}

export function isSessionResumable(
  session: Pick<SessionView, "state" | "nativeId" | "worktree">,
): Resumability {
  if (
    session.worktree?.state === "closed" ||
    (session.state !== "stopped" && session.state !== "discovered")
  ) {
    return { resumable: false, reason: "state" };
  }
  if (
    session.nativeId === undefined ||
    session.nativeId === null ||
    session.nativeId.length === 0
  ) {
    return { resumable: false, reason: "origin" };
  }
  return { resumable: true, reason: null };
}

export async function startNewSession(
  input: SessionStartInput,
  acceptResult: () => boolean = () => true,
): Promise<RuntimeSessionOut> {
  if (
    !permitsModel(input.model, {
      executionBackend: input.execution_backend,
      privacyMode: input.privacy_mode,
    })
  ) {
    throw new DaemonError({
      code: "privacy_native_unsupported",
      message: "This protection mode requires a gateway model",
    });
  }
  log.info("starting session via REST", {
    harness: input.harness,
    model: input.model || null,
    cwd: input.cwd,
    mode: input.mode ?? null,
    effort: input.effort ?? null,
  });
  const body: RuntimeStartIn & Partial<PolicyRequest> & { operation_id?: string } = {
    harness: input.harness,
    ...(modelSelection(input.model).model_source === "native"
      ? modelSelection(input.model)
      : { model: input.model }),
    cwd: input.cwd,
    ...(input.execution_backend === undefined
      ? {}
      : { execution_backend: input.execution_backend }),
    ...(input.privacy_mode === undefined ? {} : { privacy_mode: input.privacy_mode }),
    ...(input.worktree ? { worktree: true } : {}),
    ...(input.worktree_id === undefined ? {} : { worktree_id: input.worktree_id }),
    ...(input.operation_id === undefined ? {} : { operation_id: input.operation_id }),
    ...(input.mode === undefined || input.mode === null || input.mode.length === 0
      ? {}
      : { mode: input.mode }),
    ...(input.effort === undefined || input.effort === null || input.effort.length === 0
      ? {}
      : { effort: input.effort }),
  };
  try {
    const result = await startSessionRest(body);
    const effective = policyFromWire(result);
    if (
      (input.privacy_mode === "surrogate" ||
        input.execution_backend === "docker" ||
        input.worktree ||
        input.worktree_id) &&
      (!effective.policyConfirmed ||
        effective.executionBackend !== (input.execution_backend ?? "host") ||
        effective.privacyMode !== (input.privacy_mode ?? "none") ||
        ((input.worktree || input.worktree_id) && !effective.worktree))
    ) {
      throw new DaemonError({
        code: "session_policy_unconfirmed",
        message: "The daemon did not confirm the requested protection",
      });
    }
    log.info("session started", {
      id: result.id,
      harness: result.harness,
      gatewayRouteId: result.gateway_route_id ?? null,
    });
    if (acceptResult()) seedStartedSession(result, input.cwd, input.effort ?? null, input.model);
    return result;
  } catch (error) {
    log.error("session start failed", {
      harness: input.harness,
      code: error instanceof DaemonError ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function seedStartedSession(
  payload: RuntimeSessionOut,
  cwd: string,
  effort?: string | null,
  model?: string,
): void {
  const harness = HARNESS_KINDS.includes(payload.harness)
    ? (payload.harness as HarnessKind)
    : undefined;
  if (harness === undefined) {
    return;
  }
  const state = sessionsStore.getState();
  const existing = state.sessions[payload.id];
  const view: SessionView = {
    ...existing,
    ...policyFromWire(payload, existing),
    id: payload.id,
    harness,
    state: "live",
    deleted: false,
    title: existing?.title ?? `${harness}: ${payload.id.slice(0, 8)}`,
    projectPath:
      (payload.project_path !== undefined && payload.project_path !== null
        ? payload.project_path
        : cwd) || existing?.projectPath,
    interactionMode: payload.mode ?? existing?.interactionMode,
    reasoningEffort: effort ?? existing?.reasoningEffort ?? null,
    model: model ?? existing?.model,
    activity: "idle",
    pendingApprovals: existing?.pendingApprovals ?? 0,
    gatewayRouteId: payload.gateway_route_id ?? undefined,
    nativeId: existing?.nativeId ?? null,
    daemonOrigin: true,
    needsAttention: false,
  };
  sessionsStore.setState({
    sessions: { ...state.sessions, [payload.id]: view },
    order: state.order.includes(payload.id) ? state.order : [...state.order, payload.id],
  });
}

export async function stopSessionAction(sessionId: string): Promise<void> {
  const session = sessionsStore.getState().sessions[sessionId];
  if (session?.stopping) return;
  const generation = daemonIdentity.getState().generation;
  sessionsStore.getState().applySessionPatch(sessionId, {
    stopping: true,
    stopRevision: (session?.stopRevision ?? 0) + 1,
  });
  invalidateAvailability(sessionId);
  try {
    await stopSessionRest(sessionId);
    if (generation !== daemonIdentity.getState().generation) return;
    sessionsStore.getState().applySessionPatch(sessionId, {
      ...(sessionsStore.getState().sessions[sessionId]
        ? stoppedPatch(sessionsStore.getState().sessions[sessionId]!, Date.now())
        : {}),
      state: "stopped",
      activity: "idle",
      nativeTurnActive: false,
      awaitingResponse: false,
      sending: false,
    });
    void refreshAvailability(sessionId);
  } finally {
    if (generation === daemonIdentity.getState().generation)
      sessionsStore.getState().applySessionPatch(sessionId, { stopping: false, sending: false });
  }
}

export function restoreNativeModelAction(sessionId: string): Promise<void> {
  return queueSessionModelChange(sessionId, async () => {
    if (!permitsNative(sessionsStore.getState().sessions[sessionId] ?? {})) {
      throw new DaemonError({
        code: "privacy_native_unsupported",
        message: "Protected sessions cannot restore native models",
      });
    }
    const generation = daemonIdentity.getState().generation;
    const availability = await restoreNativeModel(sessionId);
    const updated = await getSession(sessionId);
    if (generation !== daemonIdentity.getState().generation) return;
    invalidateSessionMetadata();
    sessionsStore.getState().upsertFromRest([updated]);
    if (updated.model_source === "native") {
      sessionsStore.getState().applySessionPatch(sessionId, { gatewayRouteId: undefined });
    }
    applyAvailability(sessionId, availability);
  });
}

const resumes = new Map<string, Promise<void>>();

export function resumeSessionAction(sessionId: string): Promise<void> {
  const existing = resumes.get(sessionId);
  if (existing !== undefined) return existing;
  sessionsStore.getState().applySessionPatch(sessionId, {
    resumeStartedAt: Date.now(),
    lastStoppedAt: undefined,
    nativeTurnActive: undefined,
    nativeTurnNotice: undefined,
    nativeTurnCompacting: false,
    promptError: undefined,
  });
  const pending = resumeSession(sessionId).finally(() => {
    resumes.delete(sessionId);
    sessionsStore.getState().applySessionPatch(sessionId, { resumeStartedAt: undefined });
  });
  resumes.set(sessionId, pending);
  return pending;
}

async function resumeSession(sessionId: string): Promise<void> {
  log.info("resuming session via REST", { sessionId });
  const mode = sessionsStore.getState().sessions[sessionId]?.resumeMode;
  const result = await resumeSessionRest(sessionId, undefined, mode);
  const previous = sessionsStore.getState().sessions[sessionId];
  const policy = policyFromWire(result, previous);
  if (
    policy.executionReason === "session_policy_conflict" ||
    ((previous?.privacyMode === "surrogate" || previous?.executionBackend === "docker") &&
      !policyFromWire(result).policyConfirmed)
  ) {
    sessionsStore.getState().applySessionPatch(sessionId, { ...policy, effectiveBinding: false });
    throw new DaemonError({
      code: "session_policy_unconfirmed",
      message: "The daemon did not confirm the resumed session policy",
    });
  }
  sessionsStore.getState().applySessionPatch(sessionId, {
    ...policy,
    ...(["stopped", "failed", "blocked"].includes(previous?.executionPhase ?? "")
      ? { executionPhase: undefined, executionReason: undefined, effectiveBinding: false }
      : {}),
    state: "live",
    lastStoppedAt: undefined,
    needsAttention: false,
    activity: "idle",
    gatewayRouteId: result.gateway_route_id ?? undefined,
    interactionMode: result.mode ?? sessionsStore.getState().sessions[sessionId]?.interactionMode,
    resumeMode: undefined,
  });
  sessionFeed.subscribeSession(sessionId);
}

export async function renameSessionAction(sessionId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return;
  }
  await renameSessionRest(sessionId, trimmed);
  sessionsStore.getState().renameLocal(sessionId, trimmed);
}

export async function deleteSessionAction(
  sessionId: string,
  purge?: boolean,
  discardWorktree?: boolean,
): Promise<void> {
  await deleteSessionRest(sessionId, purge, undefined, discardWorktree);
  keepAlive.forget(sessionId);
  panesStore.getState().closePane(sessionId);
  sessionFeed.closeSession(sessionId);
  transcriptStore.getState().removeTranscript(sessionId);
  sessionsStore.getState().markDeleted(sessionId);
}
