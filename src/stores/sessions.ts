import { ingestConversationStatus } from "./conversationStatus";
import { daemonIdentity } from "@/daemon/identity";
import { composerStorageKey, readSessionDrafts, writeComposerStorage } from "@/lib/composerStorage";
import { sessionModelRef } from "@/daemon/modelSelection";
import { policyFromWire, type SessionPolicy } from "@/daemon/protection";
import { createStore } from "zustand/vanilla";
import type {
  ActivityState,
  EventMessage,
  HarnessKind,
  ServerMessage,
  SessionState,
  SessionStopCause,
  SnapshotMessage,
  SnapshotSession,
} from "@/daemon/types/ws";
import type { components } from "@/daemon/types/rest.gen";
import type { TranscriptNode } from "@/features/transcript/parse/types";
import { nativeCompactionActive, nativeTurnNotice } from "@/features/transcript/turnActivity";
import { stoppedNodes } from "@/features/transcript/stoppedNodes";
import { normalizeTurnEvent } from "@/features/transcript/turns/normalize";
import { reduceTurnEvent } from "@/features/transcript/turns/reducer";
import { turnCompleted, type TurnWork } from "@/features/transcript/turns/types";
export type { TurnWork } from "@/features/transcript/turns/types";
import { pendingUserBaseline, preserveLocalUserPresentation, reconcilePendingUsers } from "@/features/transcript/optimistic";
import { readPendingUsers, writePendingUsers } from "@/features/transcript/pendingUserStorage";
import { userImages } from "@/features/transcript/parse/images";
import type { PendingUser } from "@/features/transcript/optimistic";
import type { SessionAvailability } from "@/daemon/rest/availability";

type SessionOut = components["schemas"]["SessionOut"];

const HARNESS_KINDS: readonly string[] = ["claude", "codex", "opencode", "agy", "pi"];
const SESSION_STATES: readonly string[] = ["discovered", "live", "stopped"];
const ACTIVITY_STATES: readonly string[] = ["active", "idle"];
const STOP_CAUSES: readonly string[] = ["viewer_stop", "crash", "daemon_stop", "idle_timeout"];
const LIFECYCLE_TYPES: readonly string[] = [
  "session_started",
  "session_stopped",
  "session_state",
  "activity",
  "control_lost",
];

export const UNGROUPED_PROJECT = "—";

export interface SessionView extends SessionPolicy {
  id: string;
  harness: HarnessKind;
  state: SessionState;
  deleted: boolean;
  title: string;
  projectPath?: string;
  model?: string;
  reasoningEffort?: string | null;
  interactionMode?: string | null;
  resumeMode?: string;
  externalBusy?: boolean;
  externalModel?: string;
  externalUnavailable?: boolean;
  activity?: ActivityState;
  lastActivityAt?: number;
  lastStopCause?: SessionStopCause;
  pendingApprovals: number;
  gatewayRouteId?: string;
  nativeId?: string | null;
  daemonOrigin?: boolean;
  needsAttention?: boolean;
  promptError?: string | null;
  sending?: boolean;
  stopping?: boolean;
  stopRevision?: number;
  lastStoppedAt?: number;
  availabilityStatus?: "checking" | "ready" | "stale";
  availabilityUpdatedAt?: number;
  awaitingResponse?: boolean;
  nativeTurnActive?: boolean;
  nativeTurnNotice?: string | null;
  nativeTurnCompacting?: boolean;
  nativeTurnStartedAt?: number;
  executionPhaseUpdatedAt?: number;
  turnWork?: readonly TurnWork[];
  resumeStartedAt?: number;
  availability?: SessionAvailability;
}

export interface SessionFilters {
  harness?: HarnessKind;
  state?: SessionState;
  text?: string;
}

export type SyncState = "idle" | "syncing";

export interface SessionsState {
  sessions: Record<string, SessionView>;
  // Keystrokes must not invalidate session metadata, the sidebar or transcripts.
  drafts: Record<string, string>;
  setDraft: (sessionId: string, text: string) => void;
  order: string[];
  filters: SessionFilters;
  syncState: SyncState;
  ingestFrame: (message: ServerMessage) => void;
  upsertFromRest: (rows: readonly SessionOut[]) => void;
  setFilters: (filters: SessionFilters) => void;
  clearFilters: () => void;
  markDeleted: (sessionId: string) => void;
  renameLocal: (sessionId: string, title: string) => void;
  setSyncState: (syncState: SyncState) => void;
  setPendingApprovals: (sessionId: string, count: number) => void;
  applySessionPatch: (sessionId: string, patch: Partial<SessionView>) => void;
}

export type SessionsSnapshot = Pick<SessionsState, "sessions" | "order" | "filters">;

interface LifecycleRaw extends SessionPolicy {
  type: string;
  sessionId: string;
  harness?: HarnessKind;
  state?: SessionState;
  activity?: ActivityState;
  lastActivityAt?: number;
  cause?: SessionStopCause;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseHarness(value: unknown): HarnessKind | undefined {
  return typeof value === "string" && HARNESS_KINDS.includes(value)
    ? (value as HarnessKind)
    : undefined;
}

function parseState(value: unknown): SessionState | undefined {
  return typeof value === "string" && SESSION_STATES.includes(value)
    ? (value as SessionState)
    : undefined;
}

function parseActivity(value: unknown): ActivityState | undefined {
  return typeof value === "string" && ACTIVITY_STATES.includes(value)
    ? (value as ActivityState)
    : undefined;
}

function parseCause(value: unknown): SessionStopCause | undefined {
  return typeof value === "string" && STOP_CAUSES.includes(value)
    ? (value as SessionStopCause)
    : undefined;
}

function parseEffort(value: unknown): string | null | undefined {
  return typeof value === "string" || value === null ? value : undefined;
}

function parseLifecycle(raw: unknown): LifecycleRaw | null {
  const record = asRecord(raw);
  const type = record?.["type"];
  if (typeof type !== "string" || !LIFECYCLE_TYPES.includes(type)) {
    return null;
  }
  const sessionId = record?.["session_id"];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return null;
  }
  return {
    type,
    sessionId,
    ...policyFromWire(record),
    harness: parseHarness(record?.["harness"]),
    state: parseState(record?.["state"]),
    activity: parseActivity(record?.["activity"]),
    lastActivityAt:
      typeof record?.["last_activity_at"] === "number" ? record["last_activity_at"] : undefined,
    cause: parseCause(record?.["cause"]),
  };
}

function parseSnapshotSession(entry: unknown): SnapshotSession | null {
  const record = asRecord(entry);
  const id = record?.["id"];
  const title = record?.["title"];
  if (typeof id !== "string" || id.length === 0 || typeof title !== "string") {
    return null;
  }
  const harness = parseHarness(record?.["harness"]);
  const state = parseState(record?.["state"]);
  if (harness === undefined || state === undefined) {
    return null;
  }
  return { id, harness, state, title };
}

function fallbackTitle(harness: HarnessKind, sessionId: string): string {
  return `${harness}: ${sessionId.slice(0, 8)}`;
}

function compareRecency(a: SessionView, b: SessionView): number {
  const aAt = a.lastActivityAt ?? 0;
  const bAt = b.lastActivityAt ?? 0;
  return bAt - aAt || a.id.localeCompare(b.id);
}

function matchesText(session: SessionView, text: string): boolean {
  return (
    session.title.toLowerCase().includes(text) ||
    (session.projectPath?.toLowerCase().includes(text) ?? false) ||
    (session.model?.toLowerCase().includes(text) ?? false)
  );
}

export function selectVisibleSessions(state: SessionsSnapshot): SessionView[] {
  const text = state.filters.text?.trim().toLowerCase() ?? "";
  const visible: SessionView[] = [];
  for (const id of state.order) {
    const session = state.sessions[id];
    if (session === undefined || session.deleted) {
      continue;
    }
    if (state.filters.harness !== undefined && session.harness !== state.filters.harness) {
      continue;
    }
    if (state.filters.state !== undefined && session.state !== state.filters.state) {
      continue;
    }
    if (text.length > 0 && !matchesText(session, text)) {
      continue;
    }
    visible.push(session);
  }
  return visible.sort(compareRecency);
}

export function sessionWorkspace(session: Pick<SessionView, "projectPath" | "worktree">): string | undefined {
  return session.worktree?.source_path ?? session.projectPath;
}

export function selectByProject(
  state: SessionsSnapshot,
): { project: string; sessions: SessionView[] }[] {
  const grouped = new Map<string, SessionView[]>();
  for (const session of selectVisibleSessions(state)) {
    const key = sessionWorkspace(session) ?? UNGROUPED_PROJECT;
    const bucket = grouped.get(key);
    if (bucket === undefined) {
      grouped.set(key, [session]);
    } else {
      bucket.push(session);
    }
  }
  return [...grouped.entries()]
    .map(([project, sessions]) => ({ project, sessions }))
    .sort((a, b) => {
      const aUngrouped = a.project === UNGROUPED_PROJECT;
      const bUngrouped = b.project === UNGROUPED_PROJECT;
      if (aUngrouped !== bUngrouped) {
        return aUngrouped ? 1 : -1;
      }
      const aAt = a.sessions[0]?.lastActivityAt ?? 0;
      const bAt = b.sessions[0]?.lastActivityAt ?? 0;
      return bAt - aAt || a.project.localeCompare(b.project);
    });
}

export function selectSessionById(state: SessionsSnapshot, id: string): SessionView | undefined {
  return state.sessions[id];
}

export function stoppedPatch(session: SessionView, stoppedAt: number, cause?: SessionStopCause): Partial<SessionView> {
  const external = session.externalBusy === true;
  return {
    activity: "idle",
    stopRevision: (session.stopRevision ?? 0) + 1,
    lastStoppedAt: stoppedAt,
    nativeTurnActive: external ? session.nativeTurnActive : false,
    awaitingResponse: false,
    sending: false,
    nativeTurnNotice: null,
    nativeTurnCompacting: false,
    availabilityStatus: "stale",
    availabilityUpdatedAt: undefined,
    turnWork: external ? session.turnWork : session.turnWork?.map((turn) => !turnCompleted(turn)
      ? { ...turn, endedAt: Math.max(turn.startedAt ?? stoppedAt, stoppedAt), outcome: cause === "crash" ? "failed" : "stopped" }
      : turn),
  };
}

export const sessionsStore = createStore<SessionsState>()((set, get) => {
  const turnEventCursors = new WeakMap<SessionView, { seq: number; ts: number }>();
  const lifecycleEventTimes = new WeakMap<SessionView, number>();
  function inheritTurnCursor(existing: SessionView | undefined, next: SessionView): void {
    const cursor = existing && turnEventCursors.get(existing);
    if (cursor) turnEventCursors.set(next, cursor);
    const lifecycleTime = existing && lifecycleEventTimes.get(existing);
    if (lifecycleTime !== undefined) lifecycleEventTimes.set(next, lifecycleTime);
  }

  function upsertView(view: SessionView): void {
    set((state) => {
      const existing = state.sessions[view.id];
      const merged: SessionView = existing === undefined ? view : { ...existing, ...view };
      inheritTurnCursor(existing, merged);
      if (
        existing !== undefined &&
        Object.keys(view).every((key) =>
          Object.is(existing[key as keyof SessionView], view[key as keyof SessionView]),
        ) &&
        state.order.includes(view.id)
      ) {
        return state;
      }
      return {
        sessions: { ...state.sessions, [view.id]: merged },
        order: state.order.includes(view.id) ? state.order : [...state.order, view.id],
      };
    });
  }

  function patchSession(sessionId: string, patch: (existing: SessionView) => SessionView): void {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (existing === undefined) {
        return state;
      }
      let next = patch(existing);
      if (next.executionPhase !== existing.executionPhase) next = { ...next, executionPhaseUpdatedAt: Date.now() };
      if (
        Object.keys(next).every((key) =>
          Object.is(existing[key as keyof SessionView], next[key as keyof SessionView]),
        )
      )
        return state;
      inheritTurnCursor(existing, next);
      return { sessions: { ...state.sessions, [sessionId]: next } };
    });
  }

  function applyLifecycle(lifecycle: LifecycleRaw, ts: number): void {
    const previous = get().sessions[lifecycle.sessionId];
    const previousTime = previous && lifecycleEventTimes.get(previous);
    if (previousTime !== undefined && ts < previousTime) return;
    if (previous) lifecycleEventTimes.set(previous, ts);
    switch (lifecycle.type) {
      case "session_started": {
        if (lifecycle.harness === undefined) {
          return;
        }
        const existing = get().sessions[lifecycle.sessionId];
        upsertView({
          id: lifecycle.sessionId,
          ...policyFromWire(
            {
              execution_backend: lifecycle.executionBackend,
              privacy_mode: lifecycle.privacyMode,
              policy_revision: lifecycle.policyRevision,
            },
            existing,
          ),
          harness: lifecycle.harness,
          state: lifecycle.state ?? "live",
          lastStoppedAt: undefined,
          deleted: false,
          title: existing?.title ?? fallbackTitle(lifecycle.harness, lifecycle.sessionId),
          pendingApprovals: existing?.pendingApprovals ?? 0,
          needsAttention: false,
        });
        const started = get().sessions[lifecycle.sessionId];
        if (started) lifecycleEventTimes.set(started, ts);
        return;
      }
      case "session_state": {
        if (lifecycle.state === undefined) {
          return;
        }
        const cleared = lifecycle.state === "live";
        patchSession(lifecycle.sessionId, (existing) => ({
          ...existing,
          ...(lifecycle.state === "stopped" ? stoppedPatch(existing, ts) : {}),
          state: lifecycle.state as SessionState,
          ...(lifecycle.state === "live" ? { lastStoppedAt: undefined } : {}),
          needsAttention: cleared ? false : existing.needsAttention,
        }));
        return;
      }
      case "activity": {
        patchSession(lifecycle.sessionId, (existing) => ({
          ...existing,
          activity: existing.state === "stopped" ? "idle" : lifecycle.activity,
          awaitingResponse:
            lifecycle.activity === "active" || !existing.sending
              ? false
              : existing.awaitingResponse,
          lastActivityAt: lifecycle.lastActivityAt ?? ts,
        }));
        return;
      }
      case "session_stopped": {
        patchSession(lifecycle.sessionId, (existing) => ({
          ...existing,
          ...stoppedPatch(existing, ts, lifecycle.cause),
          state: "stopped",
          lastStopCause: lifecycle.cause ?? existing.lastStopCause,
          lastActivityAt: lifecycle.lastActivityAt ?? ts,
        }));
        return;
      }
      case "control_lost":
        patchSession(lifecycle.sessionId, (existing) => ({
          ...existing,
          needsAttention: true,
        }));
        return;
    }
  }

  function applySnapshot(frame: SnapshotMessage): void {
    const sessions: Record<string, SessionView> = {};
    const order: string[] = [];
    for (const entry of frame.sessions) {
      const parsed = parseSnapshotSession(entry);
      if (parsed === null) {
        continue;
      }
      const existing = get().sessions[parsed.id];
      sessions[parsed.id] = {
        ...(existing ?? {
          pendingApprovals: 0,
          deleted: false,
          nativeId: null,
          daemonOrigin: false,
          needsAttention: false,
        }),
        ...parsed,
        ...(parsed.state === "live" ? { lastStoppedAt: undefined } : {}),
        ...(parsed.state === "stopped" && existing && (existing.state !== "stopped" || existing.sending || existing.awaitingResponse ||
          (existing.nativeTurnActive === true && !existing.externalBusy))
          ? stoppedPatch(existing, Date.now()) : {}),
        ...policyFromWire(entry, existing),
        deleted: existing?.deleted ?? false,
        pendingApprovals: existing?.pendingApprovals ?? 0,
        nativeId: existing?.nativeId ?? null,
        daemonOrigin: existing?.daemonOrigin ?? false,
        needsAttention: existing?.needsAttention ?? false,
      };
      inheritTurnCursor(existing, sessions[parsed.id]!);
      order.push(parsed.id);
    }
    set({ sessions, order });
  }

  return {
    sessions: {},
    drafts: readSessionDrafts(),
    setDraft: (sessionId, text) => {
      if (get().drafts[sessionId] === text) return;
      const drafts = { ...get().drafts };
      if (text) drafts[sessionId] = text;
      else delete drafts[sessionId];
      writeComposerStorage(composerStorageKey("text"), drafts);
      set({ drafts: { ...get().drafts, [sessionId]: text } });
    },
    order: [],
    filters: {},
    syncState: "idle",

    ingestFrame: (message) => {
      if ("type" in message) {
        if (message.type === "snapshot" && message.topic === "sessions.all") {
          applySnapshot(message);
          return;
        }
        if (message.type === "session_stopped") {
          applyLifecycle(
            {
              type: "session_stopped",
              sessionId: message.raw.session_id,
              harness: parseHarness(message.raw.harness),
              state: parseState(message.raw.state),
              cause: parseCause(message.raw.cause),
            },
            message.ts,
          );
          return;
        }
        if (message.type === "approval.pending" || message.type === "approval.resolved") {
          const raw = asRecord(message.raw);
          const sessionId = raw?.["session_id"];
          if (typeof sessionId !== "string") {
            return;
          }
          const delta = message.type === "approval.pending" ? 1 : -1;
          patchSession(sessionId, (existing) => ({
            ...existing,
            pendingApprovals: Math.max(0, existing.pendingApprovals + delta),
          }));
          return;
        }
        return;
      }
      if ("raw" in message && !("op" in message) && !("from_seq" in message)) {
        const event = message as EventMessage;
        if (event.topic.startsWith("session.")) {
          const id = event.topic.slice("session.".length);
          const session = get().sessions[id];
          if (session && event.source === session.harness) {
            if (session.state === "stopped" && session.externalBusy !== true) return;
            if (session.lastStoppedAt !== undefined && event.ts <= session.lastStoppedAt) return;
            const cursor = turnEventCursors.get(session);
            if (cursor && (event.ts < cursor.ts || (event.ts === cursor.ts && event.seq <= cursor.seq))) return;
            turnEventCursors.set(session, { seq: event.seq, ts: event.ts });
            const turnEvent = normalizeTurnEvent(session.harness, event.raw, {
              key: `${event.topic}:${event.ts}:${event.seq}`, nativeId: session.nativeId, timestamp: event.ts,
            });
            const notice = nativeTurnNotice(session.harness, session.nativeId, event.raw);
            const compacting = nativeCompactionActive(session.harness, session.nativeId, event.raw);
            patchSession(id, (existing) => {
              const turns = turnEvent ? reduceTurnEvent(existing.turnWork ?? [], turnEvent) : existing.turnWork;
              const current = turns?.at(-1);
              const active = turnEvent?.active === true && turnEvent.phase !== "finish" &&
                ((existing.state === "stopped" && !existing.externalBusy) || (current && turnCompleted(current)))
                ? existing.nativeTurnActive : turnEvent?.active;
              return {
                ...existing,
                ...(notice !== undefined ? { nativeTurnNotice: notice } : {}),
                ...(compacting !== undefined ? { nativeTurnCompacting: compacting } : {}),
                ...(active !== undefined ? {
                  nativeTurnActive: active,
                  nativeTurnStartedAt: active
                    ? existing.nativeTurnActive ? existing.nativeTurnStartedAt : turnEvent?.startedAt ?? event.ts
                    : existing.nativeTurnStartedAt,
                  awaitingResponse: false,
                } : {}),
                turnWork: turns,
              };
            });
          }
        }
        const lifecycle = parseLifecycle((message as EventMessage).raw);
        if (lifecycle !== null) {
          applyLifecycle(lifecycle, (message as EventMessage).ts);
        }
      }
    },

    upsertFromRest: (rows) => {
      for (const row of rows) ingestConversationStatus(row.status);
      for (const row of rows) {
        const harness = parseHarness(row.harness);
        if (harness === undefined) {
          continue;
        }
        const existing = get().sessions[row.id];
        const rowEffort = parseEffort((row as Record<string, unknown>)["reasoning_effort"]);
        upsertView({
          id: row.id,
          harness,
          state: parseState(row.state) ?? "discovered",
          ...(row.state === "live" ? { lastStoppedAt: undefined } : {}),
          ...(row.state === "stopped" && existing && (existing.state !== "stopped" || existing.sending || existing.awaitingResponse ||
            (existing.nativeTurnActive === true && !existing.externalBusy))
            ? stoppedPatch(existing, Date.now()) : {}),
          deleted: existing?.deleted ?? false,
          title: row.title,
          projectPath: row.project_path.length > 0 ? row.project_path : existing?.projectPath,
          model: sessionModelRef(row) ?? existing?.model,
          ...policyFromWire(row, existing),
          interactionMode: row.interaction_mode?.mode ?? existing?.interactionMode,
          resumeMode: existing?.resumeMode,
          reasoningEffort: rowEffort === undefined ? existing?.reasoningEffort : rowEffort,
          activity: row.state === "stopped" ? "idle" : parseActivity(row.activity) ?? existing?.activity,
          lastActivityAt: row.last_activity_at ?? existing?.lastActivityAt,
          lastStopCause: existing?.lastStopCause,
          pendingApprovals: existing?.pendingApprovals ?? 0,
          gatewayRouteId: existing?.gatewayRouteId,
          nativeId: row.native_id === null ? (existing?.nativeId ?? null) : row.native_id,
          daemonOrigin: existing?.daemonOrigin ?? false,
          needsAttention: existing?.needsAttention ?? false,
        });
      }
    },

    setFilters: (filters) => {
      set({ filters });
    },

    clearFilters: () => {
      set({ filters: {} });
    },

    markDeleted: (sessionId) => {
      patchSession(sessionId, (existing) => ({ ...existing, deleted: true }));
    },

    renameLocal: (sessionId, title) => {
      patchSession(sessionId, (existing) => ({ ...existing, title }));
    },

    setSyncState: (syncState) => {
      set({ syncState });
    },

    setPendingApprovals: (sessionId, count) => {
      patchSession(sessionId, (existing) => ({
        ...existing,
        pendingApprovals: Math.max(0, count),
      }));
    },

    applySessionPatch: (sessionId, patch) => {
      patchSession(sessionId, (existing) => ({ ...existing, ...patch }));
    },
  };
});

export interface TranscriptSnapshot {
  loadedCompletionRevision?: number | null;
  loadedCompletionTarget?: string | null;
  nodes: readonly TranscriptNode[];
  pendingUsers?: readonly PendingUser[];
  localUsers?: readonly PendingUser[];
  gapFlag: boolean;
  historyUnavailable: boolean;
  historyExhausted: boolean;
}

export type TranscriptFlagPatch = Partial<
  Pick<TranscriptSnapshot, "gapFlag" | "historyUnavailable" | "historyExhausted" | "loadedCompletionRevision" | "loadedCompletionTarget">
>;

export interface TranscriptsState {
  transcripts: Record<string, TranscriptSnapshot>;
  addPendingUser: (sessionId: string, text: string, images?: Extract<TranscriptNode, { kind: "user" }>["images"]) => string;
  updatePendingUser: (sessionId: string, key: string, text: string) => void;
  removePendingUser: (sessionId: string, key: string) => void;
  setNodes: (sessionId: string, nodes: readonly TranscriptNode[], persistedNodes?: readonly TranscriptNode[]) => void;
  setFlags: (sessionId: string, flags: TranscriptFlagPatch) => void;
  removeTranscript: (sessionId: string) => void;
  resetTranscripts: () => void;
}

export const transcriptStore = createStore<TranscriptsState>()((set, get) => ({
  transcripts: {},

  addPendingUser: (sessionId, text, images) => {
    const existing = get().transcripts[sessionId];
    const key = `local-${crypto.randomUUID()}`;
    const pending: PendingUser = {
      node: { kind: "user", text, key, ...(images?.length ? { images } : {}), localPresentation: { key, images } },
      baseline: pendingUserBaseline(existing?.nodes ?? []),
    };
    set({
      transcripts: {
        ...get().transcripts,
        [sessionId]: {
          nodes: existing?.nodes ?? [],
          gapFlag: false,
          historyUnavailable: false,
          historyExhausted: false,
          ...existing,
          pendingUsers: [...(existing?.pendingUsers ?? []), pending],
          localUsers: [...(existing?.localUsers ?? existing?.pendingUsers ?? []), pending],
        },
      },
    });
    return key;
  },

  updatePendingUser: (sessionId, key, text) => {
    const existing = get().transcripts[sessionId];
    if (!existing) return;
    const localUsers = (existing.localUsers ?? existing.pendingUsers ?? []).map((entry) => {
      if (entry.node.key !== key) return entry;
      const previews = entry.node.localPresentation?.images;
      const references = userImages(text).images;
      const images = previews?.length === references.length ? previews?.map((image, index) => ({
        ...image, path: references[index]!.path ?? references[index]!.source,
      })) : undefined;
      return { ...entry, node: { ...entry.node, text, images: undefined, localPresentation: { key, images } } };
    });
    set({ transcripts: { ...get().transcripts, [sessionId]: {
      ...existing, localUsers, pendingUsers: reconcilePendingUsers(localUsers, existing.nodes),
    } } });
  },

  removePendingUser: (sessionId, key) => {
    const existing = get().transcripts[sessionId];
    if (!existing) return;
    set({
      transcripts: {
        ...get().transcripts,
        [sessionId]: {
          ...existing,
          pendingUsers: existing.pendingUsers?.filter((pending) => pending.node.key !== key),
          localUsers: existing.localUsers?.filter((pending) => pending.node.key !== key),
        },
      },
    });
  },

  setNodes: (sessionId, nodes, persistedNodes) => {
    const existing = get().transcripts[sessionId];
    const local = existing?.localUsers ?? existing?.pendingUsers ?? readPendingUsers(sessionId);
    const presented = preserveLocalUserPresentation(existing?.nodes ?? [], nodes, local);
    const localUsers = persistedNodes ? reconcilePendingUsers(local, persistedNodes) : local;
    const next: TranscriptSnapshot = {
      nodes: presented,
      loadedCompletionRevision: existing?.loadedCompletionRevision,
      loadedCompletionTarget: existing?.loadedCompletionTarget,
      localUsers,
      pendingUsers: reconcilePendingUsers(localUsers, nodes),
      gapFlag: existing?.gapFlag ?? false,
      historyUnavailable: existing?.historyUnavailable ?? false,
      historyExhausted: existing?.historyExhausted ?? false,
    };
    set({ transcripts: { ...get().transcripts, [sessionId]: next } });
  },

  setFlags: (sessionId, flags) => {
    const existing = get().transcripts[sessionId];
    const next: TranscriptSnapshot = {
      nodes: existing?.nodes ?? [],
      pendingUsers: existing?.pendingUsers,
      localUsers: existing?.localUsers,
      gapFlag: existing?.gapFlag ?? false,
      historyUnavailable: existing?.historyUnavailable ?? false,
      historyExhausted: existing?.historyExhausted ?? false,
      loadedCompletionRevision: existing?.loadedCompletionRevision,
      loadedCompletionTarget: existing?.loadedCompletionTarget,
      ...flags,
    };
    set({ transcripts: { ...get().transcripts, [sessionId]: next } });
  },

  removeTranscript: (sessionId) => {
    writePendingUsers(sessionId, []);
    const transcripts = { ...get().transcripts };
    delete transcripts[sessionId];
    set({ transcripts });
  },

  resetTranscripts: () => {
    set({ transcripts: {} });
  },
}));

transcriptStore.subscribe((state, previous) => {
  for (const [id, transcript] of Object.entries(state.transcripts)) {
    if (transcript.localUsers && transcript.localUsers !== previous.transcripts[id]?.localUsers) {
      writePendingUsers(id, transcript.localUsers);
    }
  }
});

export function selectTranscript(
  state: TranscriptsState,
  sessionId: string,
): TranscriptSnapshot | undefined {
  return state.transcripts[sessionId];
}

sessionsStore.subscribe((state, previous) => {
  for (const [id, session] of Object.entries(state.sessions)) {
    if (session.state !== "stopped" || session.externalBusy === true ||
      (previous.sessions[id]?.state === "stopped" && previous.sessions[id]?.externalBusy !== true)) continue;
    const nodes = transcriptStore.getState().transcripts[id]?.nodes;
    if (!nodes) continue;
    const settled = stoppedNodes(nodes);
    if (settled.some((node, index) => node !== nodes[index])) transcriptStore.getState().setNodes(id, settled);
  }
});

daemonIdentity.subscribe(() => sessionsStore.setState({ drafts: readSessionDrafts() }));
