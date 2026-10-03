import { getDaemonSocket } from "@/app/connection";
import { alignCodexUsers } from "./codexUserIdentity";
import { parseStoredLine } from "./storedLine";
import { historyTurnEvents, historyTurnWork, mergeHistoryTurnEvents, turnNodeAnchor, turnNodeIdentities } from "./historyWork";
import { mergeTurnWork } from "@/features/transcript/turns/reducer";
import { turnCompleted, type TurnEvent } from "@/features/transcript/turns/types";
import { stoppedNodes } from "@/features/transcript/stoppedNodes";
import { mergeAgyHistory } from "./agyHistory";
import { DaemonError } from "@/daemon/errors";
import { TopicSeqTracker } from "@/daemon/ws/protocol";
import { appendTranscriptNodes, mergeHistoryAndLive } from "./transcriptMerge";
import { createDebugLogger } from "@/lib/debug";
import type { RequestParamsOf } from "@/daemon/ws/protocol";
import type {
  ActionResultMap,
  ApprovalDecision,
  EventMessage,
  HarnessKind,
  RequestAction,
  ServerMessage,
  WsTopic,
} from "@/daemon/types/ws";
import { createAgyHistoryContext, createClaudeStreamState, parseFrame } from "@/features/transcript/parse";
import type { ParseContext, TranscriptNode } from "@/features/transcript/parse";
import { connectionStore } from "@/stores/connection";
import { sessionsStore, transcriptStore } from "@/stores/sessions";

export const HISTORY_PAGE_LIMIT = 500;
const HINT_LIMIT = 512;
const HISTORY_RETRY_BASE_MS = 500;
const HISTORY_RETRY_MAX_MS = 8_000;

const log = createDebugLogger("sessionFeed");

export interface HistoryPage {
  completion_revision?: number | null;
  completion_target?: string | null;
  turn_active?: boolean | null;
  external_busy?: boolean | null;
  external_model?: string | null;
  entries: readonly string[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface SocketLike {
  request: <A extends RequestAction>(
    action: A,
    params: RequestParamsOf<A>,
  ) => Promise<ActionResultMap[A]>;
  subscribe?: (topic: WsTopic, since?: number | null) => void;
  unsubscribe?: (topic: WsTopic) => void;
}

export type HistoryFetcher = (
  sessionId: string,
  cursor: string | null,
  limit: number,
) => Promise<HistoryPage>;

export interface SessionFeedDeps {
  fetchHistoryPage: HistoryFetcher;
  getSocket: () => SocketLike | null;
}

export interface PromptOutcome {
  state: "queued" | "steered";
  code: string | null;
}

export interface SessionBufferFlags {
  gapFlag: boolean;
  historyUnavailable: boolean;
  historyExhausted: boolean;
}

interface SessionBuffer extends SessionBufferFlags {
  sessionId: string;
  harness: HarnessKind;
  tracker: TopicSeqTracker;
  historyCursor: string | null;
  historyCount: number;
  historyNodes: TranscriptNode[];
  liveNodes: Map<string, TranscriptNode>;
  agyHistory: string[];
  turnHistory: TurnEvent[];
  historyDeferred: boolean;
  stopHistoryDeferral?: () => void;
  loadingHistory: boolean;
  historyRequest?: Promise<void>;
  cancelHistoryRetry?: () => void;
  refreshPending: boolean;
  preservePending?: boolean;
  historyError?: string;
  messageRoles: Map<string, "user" | "assistant">;
  partKinds: Map<string, "text" | "reasoning">;
  piStream: import("@/features/transcript/parse/pi").PiStreamState;
  claudeStream: ReturnType<typeof createClaudeStreamState>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function defaultHistoryFetcher(): HistoryFetcher {
  return async (sessionId, cursor, limit) => {
    const socket = getDaemonSocket();
    if (socket === null)
      throw new DaemonError({ code: "service_unavailable", message: "socket not connected" });
    return socket.request("session.history", { session_id: sessionId, cursor, limit });
  };
}

function defaultDeps(): SessionFeedDeps {
  return {
    fetchHistoryPage: defaultHistoryFetcher(),
    getSocket: () => getDaemonSocket(),
  };
}

function setHint<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.has(key)) {
    map.set(key, value);
    return;
  }
  if (map.size >= HINT_LIMIT) {
    const oldest = map.keys().next();
    if (!oldest.done && oldest.value !== undefined) {
      map.delete(oldest.value);
    }
  }
  map.set(key, value);
}

function historyErrorMessage(error: unknown): string {
  if (error instanceof DaemonError) {
    return `History unavailable (${error.code}). The stored conversation could not be loaded.`;
  }
  return "History unavailable. The stored conversation could not be loaded.";
}

export class SessionFeedService {
  private readonly deps: SessionFeedDeps;
  private readonly buffers = new Map<string, SessionBuffer>();
  private readonly promptOutcomes = new Map<string, PromptOutcome>();

  constructor(deps?: Partial<SessionFeedDeps>) {
    const resolved = defaultDeps();
    this.deps = {
      fetchHistoryPage: deps?.fetchHistoryPage ?? resolved.fetchHistoryPage,
      getSocket: deps?.getSocket ?? resolved.getSocket,
    };
  }

  ensureSession(
    sessionId: string,
    harness: HarnessKind,
    options: { newSession?: boolean } = {},
  ): void {
    if (this.buffers.has(sessionId)) {
      log.trace("ensureSession already ensured", { sessionId, harness });
      return;
    }
    log.info("ensureSession creating buffer", {
      sessionId,
      harness,
      socketOpen: this.deps.getSocket() !== null,
    });
    const buffer: SessionBuffer = {
      sessionId,
      harness,
      tracker: new TopicSeqTracker(),
      historyCursor: null,
      // A newly created session has no older messages; its transcript comes from the live feed.
      historyExhausted: options.newSession === true,
      historyUnavailable: false,
      historyCount: 0,
      historyNodes: [],
      liveNodes: new Map(),
      agyHistory: [],
      turnHistory: [],
      historyDeferred: options.newSession === true,
      gapFlag: false,
      loadingHistory: false,
      refreshPending: false,
      messageRoles: new Map(),
      partKinds: new Map(),
      piStream: {},
      claudeStream: createClaudeStreamState(),
    };
    this.buffers.set(sessionId, buffer);
    if (buffer.historyDeferred) {
      buffer.stopHistoryDeferral = connectionStore.subscribe((state, previous) => {
        if (state.status === "online" && previous.status !== "online") {
          this.enableHistory(buffer);
        }
      });
    }
    const retained = transcriptStore.getState().transcripts[sessionId];
    transcriptStore.getState().setNodes(sessionId, retained?.localUsers?.length ? retained.nodes : []);
    this.syncFlags(buffer);
  }

  hasSession(sessionId: string): boolean {
    return this.buffers.has(sessionId);
  }

  subscribeSession(sessionId: string): void {
    const buffer = this.buffers.get(sessionId);
    const socket = this.deps.getSocket();
    if (buffer === undefined) {
      log.warn("subscribeSession skipped, no buffer (ensureSession not called)", { sessionId });
      return;
    }
    if (socket?.subscribe === undefined) {
      log.warn("subscribeSession skipped, no socket", { sessionId });
      return;
    }
    const topic = `session.${sessionId}` as WsTopic;
    const since = buffer.tracker.getSince(topic);
    log.info("subscribeSession sending ws subscribe", { sessionId, topic, since: since ?? null });
    if (since === undefined) {
      if (buffer.historyDeferred) socket.subscribe(topic, 0);
      else socket.subscribe(topic);
      return;
    }
    socket.subscribe(topic, since);
  }

  unsubscribeSession(sessionId: string): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined) this.enableHistory(buffer);
    const socket = this.deps.getSocket();
    if (socket?.unsubscribe === undefined) {
      log.warn("unsubscribeSession skipped, no socket", { sessionId });
      return;
    }
    log.info("unsubscribeSession sending ws unsubscribe", { sessionId });
    socket.unsubscribe(`session.${sessionId}` as WsTopic);
  }

  getNodes(sessionId: string): readonly TranscriptNode[] {
    return transcriptStore.getState().transcripts[sessionId]?.nodes ?? [];
  }

  getFlags(sessionId: string): SessionBufferFlags {
    const snapshot = transcriptStore.getState().transcripts[sessionId];
    return {
      gapFlag: snapshot?.gapFlag ?? false,
      historyUnavailable: snapshot?.historyUnavailable ?? false,
      historyExhausted: snapshot?.historyExhausted ?? false,
    };
  }

  getPromptOutcome(sessionId: string): PromptOutcome | undefined {
    return this.promptOutcomes.get(sessionId);
  }

  ingestSessionFrame(sessionId: string, harness: HarnessKind, message: ServerMessage): void {
    this.ensureSession(sessionId, harness);
    const buffer = this.buffers.get(sessionId);
    if (buffer === undefined) {
      return;
    }
    if ("op" in message && message.op === "subscribed") {
      void this.loadHistory(sessionId, { refresh: true, preserveOlder: true });
      return;
    }
    if ("type" in message) {
      if (message.type === "gap" && message.topic === `session.${sessionId}`) {
        if (message.reason === "history_lost") {
          buffer.tracker.reset(`session.${sessionId}`);
          buffer.messageRoles.clear();
          buffer.partKinds.clear();
          buffer.claudeStream.clear();
          buffer.piStream = {};
        }
        log.warn("session gap frame", { sessionId });
        this.handleGap(sessionId);
        return;
      }
      if (message.type === "control_lost" && message.topic === `session.${sessionId}`) {
        log.error("control channel lost", { sessionId });
        this.appendNodes(buffer, [
          {
            kind: "system",
            level: "error",
            text: "Control channel lost. The session needs attention.",
            messageKey: "core.transcript.control_lost",
          },
        ]);
      }
      if ("seq" in message && "topic" in message && message.topic === `session.${sessionId}`) {
        buffer.tracker.record(message.topic, message.seq);
      }
      return;
    }
    if (!("raw" in message) || !("seq" in message)) {
      return;
    }
    const event = message as EventMessage;
    const recorded = buffer.tracker.record(`session.${sessionId}`, event.seq);
    if (recorded.ok && recorded.duplicate) return;
    if (!recorded.ok) this.handleGap(sessionId);
    if (event.source === "mandri" && asRecord(event.raw)?.["type"] === "history_changed") {
      if (asRecord(event.raw)?.["reset"] === true) {
        // A native branch/session switch replaces the conversation, including
        // optimistic rows and in-flight history from the previous branch.
        buffer.stopHistoryDeferral?.();
        buffer.cancelHistoryRetry?.();
        this.buffers.delete(sessionId);
        transcriptStore.getState().removeTranscript(sessionId);
        sessionsStore.getState().applySessionPatch(sessionId, { turnWork: [], nativeTurnActive: false });
        this.ensureSession(sessionId, harness);
        this.buffers.get(sessionId)!.tracker = buffer.tracker;
        void this.loadHistory(sessionId, { refresh: true });
      } else {
        this.enableHistory(buffer);
        void this.loadHistory(sessionId, { refresh: true, preserveOlder: true });
      }
      return;
    }
    log.trace("session event ingested", {
      sessionId,
      seq: event.seq,
      source: event.source,
      rawType: asRecord(event.raw)?.["type"] ?? null,
    });
    if (event.source === "mandri") {
      const raw = asRecord(event.raw);
      const degradation = raw === undefined ? undefined : raw["error"];
      if (degradation === "usage_collection_failed") return;
      if (typeof degradation === "string") {
        this.appendNodes(buffer, [
          {
            kind: "system",
            level: "warning",
            text: `Feed degraded (${degradation}). This part of the transcript may be incomplete.`,
            messageKey: "core.transcript.feed_degraded",
          },
        ]);
      }
      return;
    }
    if (harness === "opencode") {
      this.updateOpenCodeHints(buffer, event.raw);
    }
    const nodes = parseFrame(harness, event.raw, this.buildContext(buffer));
    log.debug("session event parsed", {
      sessionId,
      seq: event.seq,
      nodeCount: nodes.length,
      kinds: nodes.map((node) => node.kind),
    });
    this.appendNodes(buffer, nodes);
  }

  loadHistory(
    sessionId: string,
    options: { refresh?: boolean; preserveOlder?: boolean } = {},
  ): Promise<void> {
    const buffer = this.buffers.get(sessionId);
    if (buffer === undefined) {
      log.warn("loadHistory skipped, no buffer", { sessionId });
      return Promise.resolve();
    }
    if (buffer.historyDeferred) return Promise.resolve();
    if (buffer.loadingHistory) {
      buffer.refreshPending ||= options.refresh === true;
      buffer.preservePending ||= options.preserveOlder === true;
      log.trace("loadHistory skipped, already loading", { sessionId });
      // All callers wait for the actual request, including a queued refresh.
      // Resolving early lets the viewport clear its loading guard mid-request.
      return buffer.historyRequest ?? Promise.resolve();
    }
    const refresh = options.refresh === true;
    if (!refresh && buffer.historyExhausted) {
      log.trace("loadHistory skipped, exhausted without refresh", { sessionId });
      return Promise.resolve();
    }
    buffer.loadingHistory = true;
    buffer.historyRequest = this.fetchHistory(buffer, options);
    return buffer.historyRequest;
  }

  private async fetchHistory(
    buffer: SessionBuffer,
    options: { refresh?: boolean; preserveOlder?: boolean },
  ): Promise<void> {
    const { sessionId } = buffer;
    const refresh = options.refresh === true;
    const lifecycle = sessionsStore.getState().sessions[sessionId];
    let activityChanged = false;
    let externalActivityChanged = false;
    let externalModelChanged = false;
    const unsubscribeActivity = sessionsStore.subscribe((state, previous) => {
      const current = state.sessions[sessionId];
      const before = previous.sessions[sessionId];
      externalActivityChanged ||= current?.externalBusy !== before?.externalBusy ||
        current?.externalUnavailable !== before?.externalUnavailable;
      externalModelChanged ||= current?.externalModel !== before?.externalModel;
      if (
        current?.nativeTurnActive !== before?.nativeTurnActive ||
        current?.sending !== before?.sending ||
        current?.awaitingResponse !== before?.awaitingResponse
      ) {
        activityChanged = true;
      }
    });
    log.info("loadHistory fetching page", {
      sessionId,
      refresh,
      cursor: buffer.historyCursor,
      limit: HISTORY_PAGE_LIMIT,
      harness: buffer.harness,
    });
    try {
      const cursor = refresh ? null : buffer.historyCursor;
      const page = await this.readHistoryPage(buffer, cursor);
      if (this.buffers.get(sessionId) !== buffer) return;
      const session = sessionsStore.getState().sessions[sessionId];
      if (
        typeof page.turn_active === "boolean" &&
        !activityChanged &&
        session?.stopRevision === lifecycle?.stopRevision &&
        session?.state === lifecycle?.state &&
        !session?.stopping &&
        (page.turn_active === false || session?.state !== "stopped" || page.external_busy === true) &&
        !session?.sending &&
        !session?.awaitingResponse
      ) {
        sessionsStore
          .getState()
          .applySessionPatch(sessionId, { nativeTurnActive: page.turn_active });
      }
      if (!externalActivityChanged && typeof page.external_busy === "boolean") {
        sessionsStore.getState().applySessionPatch(sessionId, {
          externalBusy: page.external_busy,
          externalUnavailable: false,
        });
      } else if (!externalActivityChanged && page.external_busy === null) {
        sessionsStore
          .getState()
          .applySessionPatch(sessionId, { externalBusy: undefined, externalUnavailable: true });
      }
      if (!externalModelChanged && (typeof page.external_model === "string" || page.external_model === null)) {
        sessionsStore
          .getState()
          .applySessionPatch(sessionId, { externalModel: page.external_model ?? undefined });
      }
      const preserve = refresh && options.preserveOlder === true && buffer.historyCount > 0;
      if (buffer.harness === "agy") {
        buffer.agyHistory = mergeAgyHistory(
          !refresh || preserve ? buffer.agyHistory : [], page.entries,
        );
      }
      const entries = buffer.harness === "agy" ? buffer.agyHistory : page.entries;
      const context = {
        sessionId,
        messageRoles: new Map(buffer.messageRoles),
        partKinds: new Map(buffer.partKinds),
        ...(buffer.harness === "agy" ? createAgyHistoryContext(entries) : {}),
      };
      let pageNodes: TranscriptNode[] = entries.flatMap((line) => {
        if (buffer.harness === "opencode") {
          try {
            this.updateOpenCodeHints(context, JSON.parse(line));
          } catch {
            /* Invalid lines are rendered by the parser. */
          }
        }
        return parseStoredLine(buffer.harness, line, context);
      });
      const currentSession = sessionsStore.getState().sessions[sessionId];
      if (currentSession?.state === "stopped" && currentSession.externalBusy !== true) pageNodes = stoppedNodes(pageNodes);
      if (buffer.harness === "opencode") {
        // A reconnect may start in the middle of a message, after its role and
        // part type were announced. The following live deltas need those hints.
        for (const [id, role] of context.messageRoles) setHint(buffer.messageRoles, id, role);
        for (const [id, kind] of context.partKinds) setHint(buffer.partKinds, id, kind);
      }
      log.info("loadHistory page fetched", {
        sessionId,
        entryCount: page.entries.length,
        nodeCount: pageNodes.length,
        nextCursor: page.next_cursor,
        hasMore: page.has_more,
        previousHistoryCount: buffer.historyCount,
        currentLiveNodes: this.getNodes(sessionId).length,
      });
      const current = this.getNodes(sessionId).filter(
        (node) => !(node.kind === "system" && node.text === buffer.historyError),
      );
      const historyIds = new Set(buffer.historyNodes.map((node) => node.key ?? node));
      const live = current.flatMap((node) => {
        const cached = node.key === undefined ? undefined : buffer.liveNodes.get(node.key);
        return !historyIds.has(node.key ?? node) || cached ? [cached ?? node] : [];
      });
      const history = buffer.harness === "agy" ? appendTranscriptNodes([], pageNodes) : preserve
        ? mergeHistoryAndLive(buffer.historyNodes, pageNodes)
        : appendTranscriptNodes(
            [],
            refresh ? pageNodes : [...pageNodes, ...buffer.historyNodes],
          );
      const persisted = new Map(pageNodes.map((node) => [node.key, node]));
      for (const [key, node] of buffer.liveNodes) {
        const stored = persisted.get(key);
        if (stored && JSON.stringify(stored) === JSON.stringify(node)) {
          buffer.liveNodes.delete(key);
        }
      }
      const alignedHistory = alignCodexUsers(history, live);
      const merged = mergeHistoryAndLive(alignedHistory, live);
      buffer.historyCount = history.length;
      buffer.historyNodes = history;
      if (!preserve) {
        buffer.historyCursor = page.next_cursor;
        buffer.historyExhausted = !page.has_more;
      }
      buffer.historyUnavailable = false;
      buffer.historyError = undefined;
      if (refresh) {
        buffer.gapFlag = false;
      }
      transcriptStore.getState().setNodes(sessionId, merged, alignedHistory);
      const observed = sessionsStore.getState().sessions[sessionId];
      buffer.turnHistory = mergeHistoryTurnEvents(
        refresh && !preserve ? [] : buffer.turnHistory,
        historyTurnEvents(buffer.harness, entries, context, observed?.nativeId), refresh,
      );
      if (observed) {
        const turns = mergeTurnWork(observed.turnWork ?? [], historyTurnWork(buffer.turnHistory));
        sessionsStore.getState().applySessionPatch(sessionId, {
          turnWork: observed.state === "stopped" && observed.externalBusy !== true
            ? turns.map((turn) => turnCompleted(turn) ? turn : { ...turn, outcome: "stopped" }) : turns,
        });
      }
      if (
        sessionsStore.getState().sessions[sessionId]?.promptError === "error.delivery_unknown" &&
        (transcriptStore.getState().transcripts[sessionId]?.pendingUsers?.length ?? 0) === 0
      ) {
        sessionsStore.getState().applySessionPatch(sessionId, { promptError: null });
      }
      log.debug("loadHistory merged into transcript store", {
        sessionId,
        totalNodes: merged.length,
      });
      this.syncFlags(buffer);
      if (cursor === null) transcriptStore.getState().setFlags(sessionId, {
        loadedCompletionRevision: page.entries.length ? page.completion_revision ?? null : null,
        loadedCompletionTarget: page.completion_target ?? null,
      });
    } catch (error) {
      if (this.buffers.get(sessionId) !== buffer) return;
      if (
        error instanceof DaemonError &&
        error.code === "invalid_params" &&
        !refresh &&
        buffer.historyCursor !== null
      ) {
        buffer.refreshPending = true;
        buffer.preservePending = false;
        return;
      }
      log.error("loadHistory failed", {
        sessionId,
        code: error instanceof DaemonError ? error.code : null,
        message: error instanceof Error ? error.message : String(error),
      });
      buffer.historyUnavailable = true;
      this.syncFlags(buffer);
      const message = historyErrorMessage(error);
      if (buffer.historyError !== message) {
        this.appendNodes(buffer, [
          {
            kind: "system",
            level: "error",
            text: message,
            messageKey: "core.transcript.history_unavailable",
          },
        ]);
        buffer.historyError = message;
      }
    } finally {
      buffer.loadingHistory = false;
      unsubscribeActivity();
      buffer.historyRequest = undefined;
      if (this.buffers.get(sessionId) === buffer && buffer.refreshPending) {
        buffer.refreshPending = false;
        const preserveOlder = buffer.preservePending;
        buffer.preservePending = false;
        await this.loadHistory(sessionId, { refresh: true, preserveOlder });
      }
    }
  }

  private async readHistoryPage(buffer: SessionBuffer, cursor: string | null): Promise<HistoryPage> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.deps.fetchHistoryPage(buffer.sessionId, cursor, HISTORY_PAGE_LIMIT);
      } catch (error) {
        if (!(error instanceof DaemonError) ||
          (error.code !== "delivery_unknown" && error.code !== "service_unavailable") ||
          this.buffers.get(buffer.sessionId) !== buffer) throw error;
        const delayMs = Math.min(HISTORY_RETRY_MAX_MS, HISTORY_RETRY_BASE_MS * 2 ** Math.min(attempt++, 4));
        log.debug("history read interrupted; retry scheduled", {
          sessionId: buffer.sessionId, code: error.code, cursor, delayMs,
        });
        if (!await this.waitForHistoryRetry(buffer, delayMs)) throw error;
      }
    }
  }

  private waitForHistoryRetry(buffer: SessionBuffer, delayMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (retry: boolean) => {
        clearTimeout(timer);
        unsubscribe();
        buffer.cancelHistoryRetry = undefined;
        resolve(retry);
      };
      // A fresh connection can retry immediately. While already online, back
      // off transient service failures without discarding the original page.
      const unsubscribe = connectionStore.subscribe((state, previous) => {
        if (state.status === "online" && previous.status !== "online") finish(true);
      });
      const timer = setTimeout(() => {
        if (connectionStore.getState().status === "online") finish(true);
      }, delayMs);
      buffer.cancelHistoryRetry = () => finish(false);
    });
  }

  handleGap(sessionId: string): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer === undefined) {
      return;
    }
    this.enableHistory(buffer);
    buffer.gapFlag = true;
    this.syncFlags(buffer);
    void this.loadHistory(sessionId, { refresh: true });
  }

  closeSession(sessionId: string): void {
    log.info("closeSession releasing buffer", { sessionId });
    const socket = this.deps.getSocket();
    if (socket?.unsubscribe !== undefined) {
      socket.unsubscribe(`session.${sessionId}` as WsTopic);
    }
    this.buffers.get(sessionId)?.stopHistoryDeferral?.();
    this.buffers.get(sessionId)?.cancelHistoryRetry?.();
    this.buffers.delete(sessionId);
    this.promptOutcomes.delete(sessionId);
    if (!transcriptStore.getState().transcripts[sessionId]?.localUsers?.length) {
      transcriptStore.getState().removeTranscript(sessionId);
    }
  }

  async sendPrompt(sessionId: string, content: string, attachments?: string[]): Promise<PromptOutcome> {
    log.info("sendPrompt dispatching ws request", {
      sessionId,
      contentLength: content.length,
      socketOpen: this.deps.getSocket() !== null,
    });
    const result = await this.request("session.prompt", { session_id: sessionId, content, ...(attachments?.length ? { attachments } : {}) });
    log.info("sendPrompt result", { sessionId, state: result.state, code: result.code });
    const outcome: PromptOutcome = { state: result.state, code: result.code };
    this.promptOutcomes.set(sessionId, outcome);
    return outcome;
  }

  async interrupt(sessionId: string): Promise<boolean> {
    const result = await this.request("session.interrupt", { session_id: sessionId });
    if (result.interrupted) {
      const session = sessionsStore.getState().sessions[sessionId];
      sessionsStore.getState().applySessionPatch(sessionId, {
        nativeTurnActive: false,
        turnWork: session?.turnWork?.map((turn) => !turnCompleted(turn)
          ? { ...turn, endedAt: Date.now(), outcome: "stopped" } : turn),
      });
    }
    return result.interrupted;
  }

  setMode(sessionId: string, mode: string) {
    return this.request("session.mode", { session_id: sessionId, mode });
  }

  answerApproval(approvalId: string, decision: ApprovalDecision) {
    return this.request("approval.answer", { approval_id: approvalId, decision });
  }

  cancelApproval(approvalId: string) {
    return this.request("approval.cancel", { approval_id: approvalId });
  }

  private request<A extends RequestAction>(
    action: A,
    params: RequestParamsOf<A>,
  ): Promise<ActionResultMap[A]> {
    const socket = this.deps.getSocket();
    if (socket === null) {
      log.warn("ws request rejected, no socket", { action });
      return Promise.reject(
        new DaemonError({ code: "service_unavailable", message: "socket not connected" }),
      );
    }
    return socket.request(action, params);
  }

  private buildContext(buffer: SessionBuffer): ParseContext {
    return { sessionId: buffer.sessionId, messageRoles: buffer.messageRoles, partKinds: buffer.partKinds, piStream: buffer.piStream, claudeStream: buffer.claudeStream };
  }

  private enableHistory(buffer: SessionBuffer): void {
    if (!buffer.historyDeferred) return;
    buffer.historyDeferred = false;
    buffer.historyExhausted = false;
    this.syncFlags(buffer);
    buffer.stopHistoryDeferral?.();
    buffer.stopHistoryDeferral = undefined;
  }

  private updateOpenCodeHints(buffer: Pick<SessionBuffer, "messageRoles" | "partKinds">, raw: unknown): void {
    const record = asRecord(raw);
    const type = record?.["type"];
    const properties = asRecord(record?.["properties"]);
    if (properties === undefined) {
      return;
    }
    if (type === "message.updated") {
      const info = asRecord(properties["info"]);
      const id = info?.["id"];
      const role = info?.["role"];
      if (typeof id === "string" && (role === "user" || role === "assistant")) {
        setHint(buffer.messageRoles, id, role);
      }
      return;
    }
    if (type === "message.part.updated") {
      const part = asRecord(properties["part"]);
      const id = part?.["id"];
      const partType = part?.["type"];
      if (typeof id === "string" && (partType === "text" || partType === "reasoning")) {
        setHint(buffer.partKinds, id, partType);
      }
    }
  }

  private appendNodes(buffer: SessionBuffer, nodes: readonly TranscriptNode[]): void {
    if (nodes.length === 0) {
      return;
    }
    const currentSession = sessionsStore.getState().sessions[buffer.sessionId];
    if (currentSession?.state === "stopped" && currentSession.externalBusy !== true) nodes = stoppedNodes(nodes);
    const previous = this.getNodes(buffer.sessionId);
    const merged = appendTranscriptNodes(previous, nodes);
    const turnNodes = merged.slice(previous.length);
    for (const [index, node] of merged.entries()) {
      if (node.key !== undefined && node !== previous[index]) {
        buffer.liveNodes.set(node.key, node.kind === "assistant" || node.kind === "thinking" ? { ...node, delta: false } : node);
      }
    }
    transcriptStore.getState().setNodes(buffer.sessionId, merged);
    const session = sessionsStore.getState().sessions[buffer.sessionId];
    const current = session?.turnWork?.at(-1);
    if (current) {
      const anchor = turnNodeAnchor(turnNodes);
      const identities = turnNodeIdentities(turnNodes);
      if (identities.every((id) => current.identities?.includes(id)) &&
        (current.userNodeKey || !anchor.userNodeKey) &&
        (current.firstNodeKey || !anchor.firstNodeKey)) return;
      sessionsStore.getState().applySessionPatch(buffer.sessionId, {
        turnWork: session!.turnWork!.map((turn) => turn === current ? {
          ...turn,
          identities: [...new Set([...(turn.identities ?? []), ...identities])],
          userNodeKey: turn.userNodeKey ?? anchor.userNodeKey,
          firstNodeKey: turn.firstNodeKey ?? anchor.firstNodeKey,
          firstNodeKind: turn.firstNodeKind ?? anchor.firstNodeKind,
          firstNodeText: turn.firstNodeText ?? anchor.firstNodeText,
        } : turn),
      });
    }
  }

  private syncFlags(buffer: SessionBuffer): void {
    transcriptStore.getState().setFlags(buffer.sessionId, {
      gapFlag: buffer.gapFlag,
      historyUnavailable: buffer.historyUnavailable,
      historyExhausted: buffer.historyExhausted,
    });
  }
}

export const sessionFeed = new SessionFeedService();
