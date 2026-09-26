import { X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { ENTER_SPLIT_EVENT } from "@/app/keyboard";
import type { HarnessKind } from "@/daemon/types/ws";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { panesStore } from "@/stores/panes";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { SessionStatusRow } from "@/features/transcript/SessionView";
import { Composer } from "@/features/transcript/Composer";
import { Transcript } from "@/features/transcript/Transcript";
import "./panes.css";

const PANE_NUMBER_KEYS: readonly string[] = ["1", "2", "3", "4"];

export function openSessionPane(sessionId: string, harness: HarnessKind): boolean {
  const opened = panesStore.getState().openPane(sessionId);
  if (!opened) {
    return false;
  }
  sessionFeed.ensureSession(sessionId, harness);
  keepAlive.acquire(sessionId, "pane");
  return true;
}

export function closeSessionPane(sessionId: string): void {
  panesStore.getState().closePane(sessionId);
  keepAlive.release(sessionId, "pane");
  if (!keepAlive.isHeld(sessionId)) {
    sessionFeed.closeSession(sessionId);
  }
}

function layoutClassName(count: number): string {
  if (count >= 3) {
    return "panes panes--grid";
  }
  if (count === 2) {
    return "panes panes--split";
  }
  return "panes panes--single";
}

interface SessionPaneProps {
  sessionId: string;
  focused: boolean;
}

function SessionPane({ sessionId, focused }: SessionPaneProps) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const session = useStore(
    sessionsStore,
    useCallback((state) => state.sessions[sessionId], [sessionId]),
  );
  const gapFlag = useStore(
    transcriptStore,
    useCallback((state) => state.transcripts[sessionId]?.gapFlag ?? false, [sessionId]),
  );
  const harness = session?.harness;
  const title = session?.title ?? sessionId;
  const reduced = gapFlag;
  useEffect(() => {
    if (focused) {
      sectionRef.current?.focus();
    }
  }, [focused]);
  return (
    <section
      ref={sectionRef}
      className={`pane${focused ? " pane--focused" : ""}`}
      aria-label={title}
      tabIndex={-1}
    >
      <header className="pane-header">
        <span className="pane-title" title={title}>
          {title}
        </span>
        <button
          type="button"
          className="pane-close"
          aria-label={t("core.shortcuts.close_pane")}
          onClick={() => closeSessionPane(sessionId)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="pane-body">
        {harness === undefined ? null : (
          <>
            <SessionStatusRow sessionId={sessionId} />
            <Transcript sessionId={sessionId} harness={harness} reduced={reduced} />
            <Composer sessionId={sessionId} />
          </>
        )}
      </div>
    </section>
  );
}

function nextMostRecentSessionId(excludeId: string | undefined): string | undefined {
  const { sessions, order } = sessionsStore.getState();
  let best: { id: string; at: number } | undefined;
  for (const id of order) {
    if (id === excludeId) {
      continue;
    }
    const session = sessions[id];
    if (session === undefined || session.deleted) {
      continue;
    }
    const at = session.lastActivityAt ?? 0;
    if (best === undefined || at > best.at) {
      best = { id, at };
    }
  }
  return best?.id;
}

function splitTargetsFor(deepLinkId: string | undefined): string[] {
  const { sessions } = sessionsStore.getState();
  const current =
    deepLinkId === undefined ? undefined : sessions[deepLinkId];
  const targets: string[] = [];
  if (deepLinkId !== undefined && current !== undefined && !current.deleted) {
    targets.push(deepLinkId);
  }
  const nextId = nextMostRecentSessionId(deepLinkId);
  if (nextId !== undefined) {
    targets.push(nextId);
  }
  if (targets.length === 0) {
    const fallbackId = nextMostRecentSessionId(undefined);
    if (fallbackId !== undefined) {
      targets.push(fallbackId);
    }
  }
  return targets.slice(0, 2);
}

function enterSplitMode(deepLinkId: string | undefined): void {
  const { sessions } = sessionsStore.getState();
  const targets = splitTargetsFor(deepLinkId);
  for (const sessionId of targets) {
    const session = sessions[sessionId];
    if (session === undefined) {
      continue;
    }
    openSessionPane(sessionId, session.harness);
  }
  const first = targets[0];
  if (first !== undefined) {
    panesStore.getState().focusPane(first);
  }
}

function exitSplitMode(): void {
  for (const pane of [...panesStore.getState().panes]) {
    closeSessionPane(pane.sessionId);
  }
}

export interface PaneManagerProps {
  children?: ReactNode;
  deepLinkId?: string;
}

export function PaneManager({ children, deepLinkId }: PaneManagerProps) {
  const panes = useStore(panesStore, (state) => state.panes);
  const deepLinkRef = useRef(deepLinkId);
  deepLinkRef.current = deepLinkId;
  const prevDeepRef = useRef(deepLinkId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const numberIndex = PANE_NUMBER_KEYS.indexOf(event.key);
      if (numberIndex >= 0) {
        const target = panesStore.getState().panes[numberIndex];
        if (target !== undefined) {
          event.preventDefault();
          panesStore.getState().focusPane(target.sessionId);
        }
        return;
      }
      if (event.key === "w" || event.key === "W") {
        const focused = panesStore.getState().panes.find((pane) => pane.focused);
        if (focused === undefined) {
          return;
        }
        event.preventDefault();
        closeSessionPane(focused.sessionId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onEnterSplit = (): void => {
      enterSplitMode(deepLinkRef.current);
    };
    window.addEventListener(ENTER_SPLIT_EVENT, onEnterSplit);
    return () => window.removeEventListener(ENTER_SPLIT_EVENT, onEnterSplit);
  }, []);

  useEffect(() => {
    return () => {
      for (const pane of panesStore.getState().panes) {
        closeSessionPane(pane.sessionId);
      }
    };
  }, []);

  useEffect(() => {
    const previous = prevDeepRef.current;
    if (previous === deepLinkId) {
      return;
    }
    prevDeepRef.current = deepLinkId;
    if (panesStore.getState().panes.length > 0) {
      exitSplitMode();
    }
  }, [deepLinkId]);

  if (panes.length === 0) {
    return <>{children}</>;
  }
  return (
    <div className={layoutClassName(panes.length)}>
      {panes.map((pane) => (
        <SessionPane key={pane.sessionId} sessionId={pane.sessionId} focused={pane.focused} />
      ))}
    </div>
  );
}
