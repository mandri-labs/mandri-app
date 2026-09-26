import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { NeedsAttentionBadge } from "@/features/sessions/LifecycleMenu";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { createDebugLogger } from "@/lib/debug";
import { SessionApprovals } from "@/features/approvals/SessionApprovals";
import { SessionComposer } from "./SessionComposer";
import { useSessionAvailability } from "@/features/sessions/availability";
import { Transcript } from "./Transcript";
import "./session-view.css";

const log = createDebugLogger("sessionView");

export interface SessionViewProps {
  sessionId: string;
}

export function SessionStatusRow({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const session = useStore(
    sessionsStore,
    useCallback((state) => state.sessions[sessionId], [sessionId]),
  );
  if (session === undefined) {
    return null;
  }
  return (
    <div className="session-status" role="toolbar" aria-label={t("core.lifecycle.menu")}>
      {session.needsAttention === true ? <NeedsAttentionBadge sessionId={sessionId} /> : null}
    </div>
  );
}

export function SessionView({ sessionId }: SessionViewProps) {
  useSessionAvailability(sessionId);
  const session = useStore(
    sessionsStore,
    useCallback((state) => state.sessions[sessionId], [sessionId]),
  );
  const gapFlag = useStore(
    transcriptStore,
    useCallback((state) => state.transcripts[sessionId]?.gapFlag ?? false, [sessionId]),
  );
  const harness = session?.harness;
  const reduced = gapFlag;

  useEffect(() => {
    log.info("SessionView effect", { sessionId, harness: harness ?? null });
    if (harness === undefined) {
      log.warn("SessionView waiting for session metadata", { sessionId });
      return;
    }
    sessionFeed.ensureSession(sessionId, harness);
    keepAlive.acquire(sessionId, "session");
    return () => {
      log.debug("SessionView unmount", { sessionId });
      keepAlive.release(sessionId, "session");
      if (!keepAlive.isHeld(sessionId)) {
        sessionFeed.closeSession(sessionId);
      }
    };
  }, [sessionId, harness]);

  return (
    <div className="session-view">
      <div className="session-view-column">
        <SessionStatusRow sessionId={sessionId} />
        {harness === undefined ? null : (
          <>
            <Transcript sessionId={sessionId} harness={harness} reduced={reduced} />
            <SessionApprovals sessionId={sessionId} />
            <SessionComposer sessionId={sessionId} />
          </>
        )}
      </div>
    </div>
  );
}
