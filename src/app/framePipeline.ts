import { ingestConversationFrame } from "@/stores/conversationStatus";
import { ingestNativeSessionUi } from "@/stores/nativeSessionUi";
import { approvalsStore } from "@/stores/approvals";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { ingestMcpFrame } from "@/stores/mcp";
import { providersStore } from "@/stores/providers";
import { sessionsStore } from "@/stores/sessions";
import { refreshSessionMetadata } from "./sessionSync";
import { createDebugLogger } from "@/lib/debug";
import type { HarnessKind, ServerMessage } from "@/daemon/types/ws";

const log = createDebugLogger("pipeline");

export type FrameIngest = (message: ServerMessage) => void;

const ingests = new Set<FrameIngest>();
let approvalSyncStarted = false;

function ensureApprovalSync(): void {
  if (approvalSyncStarted) return;
  approvalSyncStarted = true;
  approvalsStore.subscribe((state, previous) => {
    if (state.pending === previous.pending) return;
    const pending = Object.values(state.pending);
    const sessionIds = new Set(
      [...pending, ...Object.values(previous.pending)].map((approval) => approval.sessionId),
    );
    for (const sessionId of sessionIds) {
      sessionsStore
        .getState()
        .setPendingApprovals(
          sessionId,
          pending.filter((approval) => approval.sessionId === sessionId).length,
        );
    }
  });
}

const SESSION_TOPIC_PREFIX = "session.";

const HARNESS_SOURCES: readonly string[] = ["claude", "codex", "opencode", "agy", "pi"];

function sessionTopicId(topic: string): string | undefined {
  if (!topic.startsWith(SESSION_TOPIC_PREFIX)) {
    return undefined;
  }
  const id = topic.slice(SESSION_TOPIC_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

function harnessFromSource(source: unknown): HarnessKind | undefined {
  return typeof source === "string" && HARNESS_SOURCES.includes(source)
    ? (source as HarnessKind)
    : undefined;
}

function routeSessionFrame(message: ServerMessage): void {
  if (!("topic" in message)) {
    if (message.type === "error") {
      log.error("daemon error frame", { detail: message.detail });
    } else {
      log.debug("frame without topic ignored", { type: message.type });
    }
    return;
  }
  const topic = message.topic;
  const sessionId = sessionTopicId(topic);
  if (sessionId === undefined) {
    log.trace("frame topic not a session topic", { topic });
    return;
  }
  const known = sessionsStore.getState().sessions[sessionId];
  if (known !== undefined) {
    log.trace("frame routed to session", {
      topic,
      seq: "seq" in message ? message.seq : null,
      harness: known.harness,
      source: "sessionsStore",
    });
    if (
      "raw" in message &&
      typeof message.raw === "object" &&
      message.raw !== null &&
      "external_busy" in message.raw &&
      typeof message.raw.external_busy === "boolean"
    ) {
      sessionsStore.getState().applySessionPatch(sessionId, {
        externalBusy: message.raw.external_busy,
        externalUnavailable: false,
      });
    }
    if (
      "raw" in message &&
      typeof message.raw === "object" &&
      message.raw !== null &&
      "external_busy" in message.raw &&
      message.raw.external_busy === null
    ) {
      sessionsStore
        .getState()
        .applySessionPatch(sessionId, { externalBusy: undefined, externalUnavailable: true });
    }
    if (
      "raw" in message &&
      typeof message.raw === "object" &&
      message.raw !== null &&
      "external_model" in message.raw &&
      (typeof message.raw.external_model === "string" || message.raw.external_model === null)
    ) {
      sessionsStore
        .getState()
        .applySessionPatch(sessionId, { externalModel: message.raw.external_model ?? undefined });
    }
    if (
      "raw" in message &&
      typeof message.raw === "object" &&
      message.raw !== null &&
      "unavailable" in message.raw &&
      message.raw.unavailable === true
    ) {
      sessionsStore.getState().applySessionPatch(sessionId, {
        externalBusy: undefined,
        externalModel: undefined,
        externalUnavailable: true,
      });
    }
    sessionFeed.ingestSessionFrame(sessionId, known.harness, message);
    return;
  }
  const source = harnessFromSource("source" in message ? message.source : undefined);
  if (source !== undefined) {
    log.trace("frame routed to unknown session via source", {
      topic,
      seq: "seq" in message ? message.seq : null,
      harness: source,
    });
    sessionFeed.ingestSessionFrame(sessionId, source, message);
    return;
  }
  log.debug("session frame dropped, no session and no harness source", {
    topic,
    seq: "seq" in message ? message.seq : null,
    source: "source" in message ? message.source : null,
  });
}

function routeGatewayFrame(message: ServerMessage): void {
  const topic = "topic" in message ? message.topic : undefined;
  if (topic === "gateway.events") {
    providersStore.getState().applyGatewayEvent(message);
  }
}

export function registerIngest(ingest: FrameIngest): () => void {
  ingests.add(ingest);
  return () => {
    ingests.delete(ingest);
  };
}

export function dispatchFrame(message: ServerMessage): void {
  ingestConversationFrame(message);
  ingestMcpFrame(message);
  ensureApprovalSync();
  approvalsStore.getState().ingestFrame(message);
  if (!(
    "type" in message &&
    (message.type === "approval.pending" || message.type === "approval.resolved")
  )) {
    sessionsStore.getState().ingestFrame(message);
  }
  if (
    ("type" in message && (message.type === "snapshot" || message.type === "session_stopped")) ||
    ("raw" in message &&
      typeof message.raw === "object" &&
      message.raw !== null &&
      "type" in message.raw &&
      (message.raw.type === "session_started" ||
        message.raw.type === "session_stopped" ||
        message.raw.type === "sessions_changed" ||
        message.raw.type === "session_info_changed"))
  ) {
    void refreshSessionMetadata();
  }
  ingestNativeSessionUi(message);
  routeSessionFrame(message);
  routeGatewayFrame(message);
  for (const ingest of [...ingests]) {
    ingest(message);
  }
}

export function resetIngests(): void {
  ingests.clear();
}
