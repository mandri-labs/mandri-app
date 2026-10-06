import { normalizeTurnEvent } from "./turns/normalize";
import type { HarnessKind } from "@/daemon/types/ws";
import type { SessionView } from "@/stores/sessions";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function nativeTurnActivity(
  harness: HarnessKind,
  nativeId: string | null | undefined,
  value: unknown,
): boolean | undefined {
  return normalizeTurnEvent(harness, value, { key: "activity", nativeId })?.active;
}

export function nativeCompactionActive(
  harness: HarnessKind,
  nativeId: string | null | undefined,
  value: unknown,
): boolean | undefined {
  if (harness !== "codex") return undefined;
  const raw = record(value);
  const params = record(raw?.params);
  if (nativeId && params?.threadId && params.threadId !== nativeId) return undefined;
  if (record(params?.item)?.type === "contextCompaction") {
    if (raw?.method === "item/started") return true;
    if (raw?.method === "item/completed") return false;
  }
  if (raw?.method === "turn/started" || raw?.method === "turn/completed") return false;
  return undefined;
}

export function isSessionWorking(session: SessionView | undefined): boolean {
  if (session?.externalBusy === true && !session.externalUnavailable) return true;
  if (session?.resumeStartedAt !== undefined) return true;
  if (session?.state === "stopped") return false;
  if (session?.nativeTurnCompacting) return true;
  const terminalPhase = ["failed", "blocked", "stopped"].includes(session?.executionPhase ?? "");
  const newerNativeWork =
    session?.nativeTurnStartedAt !== undefined &&
    (session.executionPhaseUpdatedAt === undefined ||
      session.nativeTurnStartedAt > session.executionPhaseUpdatedAt);
  if (session?.nativeTurnActive === true && (!terminalPhase || newerNativeWork)) return true;
  return Boolean(
    session &&
    session.state === "live" &&
    !session.promptError &&
    !session.needsAttention &&
    !["failed", "blocked", "stopped"].includes(session.executionPhase ?? "") &&
    (session.nativeTurnActive ??
      (session.sending || session.awaitingResponse || session.activity === "active")),
  );
}

export function isSessionBusy(session: SessionView | undefined): boolean {
  // A failed prompt/stop request does not prove that native work has ended.
  // Keep controls and subscriptions available until an explicit completion.
  if (!session) return false;
  if (session.stopping || session.resumeStartedAt !== undefined || isSessionWorking(session))
    return true;
  if (session.state === "stopped") return false;
  return Boolean(
    session.sending ||
    session.awaitingResponse ||
    session.pendingApprovals ||
    (session.nativeTurnActive === undefined &&
      session.activity === "active" &&
      !["failed", "blocked", "stopped"].includes(session.executionPhase ?? "")),
  );
}

export function nativeTurnNotice(
  harness: HarnessKind,
  nativeId: string | null | undefined,
  value: unknown,
): string | null | undefined {
  if (harness !== "codex") return undefined;
  const raw = record(value);
  const params = record(raw?.params);
  if (nativeId && params?.threadId && params.threadId !== nativeId) return undefined;
  if (raw?.method === "error" && params?.willRetry === true) {
    const message = record(params.error)?.message;
    return typeof message === "string" ? message : undefined;
  }
  if (
    raw?.method === "turn/started" ||
    raw?.method === "turn/completed" ||
    raw?.method === "item/started" ||
    raw?.method === "item/agentMessage/delta"
  )
    return null;
  return undefined;
}
