import { useConversationRead } from "@/features/sessions/useConversationRead";
import { useTranscriptViewport } from "./useTranscriptViewport";
import { CommandHistory } from "@/features/commands/CommandHistory";
import { commandsStore, EMPTY_COMMANDS } from "@/features/commands/store";
import { commandsForPlacement } from "@/features/commands/placement";
import type { CommandTransport } from "@/features/commands/service";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, LoaderCircle } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { useShallow } from "zustand/react/shallow";
import type { HarnessKind } from "@/daemon/types/ws";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import type { TranscriptNode } from "@/features/transcript/parse/types";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { debugPreferencesStore } from "@/stores/debugPreferences";
import type { TranscriptsState } from "@/stores/sessions";
import { TranscriptNodeRenderer } from "./renderers/TranscriptNodeRenderer";
import "./transcript.css";
import { DisclosureContext, DisclosureKeyContext } from "./renderers/Disclosure";
import { presentTranscript, presentationKey } from "./presentation";
import { groupActivities, type ActivityRow } from "./activityGroups";
import { ActivityGroup } from "./renderers/ActivityGroup";
import { ChangedFiles } from "./renderers/ChangedFiles";
import { canShowFileSummary } from "./fileChanges";
import type { PendingUser } from "./optimistic";
import { withPendingUsers } from "./optimistic";
import { isSessionWorking } from "./turnActivity";
import { WorkingIndicator, ActivityIndicator } from "./WorkingIndicator";
import { approvalsStore } from "@/stores/approvals";
import { turnCompleted, type TurnWork } from "./turns/types";
import { turnAnchors as findTurnAnchors } from "./turns/anchors";

type TranscriptRow =
  | ActivityRow
  | { kind: "commands"; key: string }
  | { kind: "turn"; turn: TurnWork; key: string }
  | { kind: "activity"; label: string; key: string }
  | { kind: "unknown-work"; key: string };
const EMPTY_TURNS: readonly TurnWork[] = [];

const FOLLOW_THRESHOLD_PX = 4;
const TOP_THRESHOLD_PX = 800;
const OVERSCAN = 8;
const ASSISTANT_BASE_PX = 20;
const ASSISTANT_MIN_PX = 20;
const ASSISTANT_MAX_PX = 400;
const ASSISTANT_CHARS_PER_LINE = 48;

const EMPTY_NODES: readonly TranscriptNode[] = [];
const EMPTY_PENDING: readonly PendingUser[] = [];

export interface TranscriptProps {
  sessionId: string;
  harness: HarnessKind;
  reduced?: boolean;
  commands?: CommandTransport;
  feed?: Pick<typeof sessionFeed, "ensureSession" | "loadHistory">;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function estimateNodeHeight(node: TranscriptNode): number {
  switch (node.kind) {
    case "user":
      return 44;
    case "assistant":
      return Math.round(
        clamp(
          Math.ceil(node.text.length / ASSISTANT_CHARS_PER_LINE) * 23 + ASSISTANT_BASE_PX,
          ASSISTANT_MIN_PX,
          ASSISTANT_MAX_PX,
        ),
      );
    case "thinking":
      return 28;
    case "tool":
      return 32;
    case "diff":
      return 32;
    case "plan":
      return 80;
    case "system":
      return 36;
    case "activity_summary":
    case "file_snapshot":
      return 0;
    case "raw":
    case "record":
      return 32;
  }
}

export const Transcript = memo(function Transcript(props: TranscriptProps) {
  // A route change must not reuse another session's measurements or follow state.
  return <SessionTranscript key={props.sessionId} {...props} />;
});

function SessionTranscript({
  sessionId,
  harness,
  reduced = false,
  feed = sessionFeed,
  commands,
}: TranscriptProps) {
  const { t } = useTranslation();
  const commandRecords = useStore(
    commandsStore,
    useCallback((state) => state.sessions[sessionId] ?? EMPTY_COMMANDS, [sessionId]),
  );
  const hasCommandHistory = commandsForPlacement(commandRecords, "transcript", harness).length > 0;
  const scrollRef = useTranscriptViewport();
  const followRef = useRef(true);
  const historyLoadingRef = useRef(false);
  const prefetchedNodesRef = useRef<readonly TranscriptNode[] | null>(null);
  const [following, setFollowing] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const sourceNodes = useStore(
    transcriptStore,
    useCallback(
      (state: TranscriptsState) => state.transcripts[sessionId]?.nodes ?? EMPTY_NODES,
      [sessionId],
    ),
  );
  const showTechnicalEvents = useStore(debugPreferencesStore, (state) => state.showTechnicalEvents);
  const pendingUsers = useStore(
    transcriptStore,
    useCallback(
      (state) => state.transcripts[sessionId]?.pendingUsers ?? EMPTY_PENDING,
      [sessionId],
    ),
  );
  const presentedNodes = useMemo(
    () => presentTranscript(withPendingUsers(sourceNodes, pendingUsers), showTechnicalEvents),
    [sourceNodes, showTechnicalEvents, pendingUsers],
  );
  const expansion = useMemo(() => new Map<string, boolean>(), []);
  const historyExhausted = useStore(
    transcriptStore,
    useCallback(
      (state: TranscriptsState) => state.transcripts[sessionId]?.historyExhausted ?? false,
      [sessionId],
    ),
  );
  const historyUnavailable = useStore(
    transcriptStore,
    useCallback(
      (state: TranscriptsState) => state.transcripts[sessionId]?.historyUnavailable ?? false,
      [sessionId],
    ),
  );
  const session = useStore(
    sessionsStore,
    useShallow((state) => {
      const current = state.sessions[sessionId];
      return {
        turnWork: current?.turnWork ?? EMPTY_TURNS,
        working: isSessionWorking(current),
        fileSummaryAllowed: canShowFileSummary(current),
        nativeTurnActive: current?.nativeTurnActive,
        externalBusy: current?.externalBusy,
        executionPhase: current?.executionPhase,
        executionBackend: current?.executionBackend,
        pendingApprovals: current?.pendingApprovals ?? 0,
        awaitingResponse: current?.awaitingResponse,
        nativeTurnNotice: current?.nativeTurnNotice,
        nativeTurnCompacting: current?.nativeTurnCompacting,
      };
    }),
  );
  const awaitingInput = useStore(
    approvalsStore,
    useCallback(
      (state) =>
        Object.values(state.pending).some(
          (approval) => approval.sessionId === sessionId && approval.kind === "user_input",
        ),
      [sessionId],
    ),
  );
  const turns = session?.turnWork ?? EMPTY_TURNS;
  const currentTurn = turns.at(-1);
  const fileSummaryAllowed = session.fileSummaryAllowed;
  const working =
    (session.nativeTurnActive === true || session.externalBusy === true) &&
    session.working &&
    (session?.externalBusy === true || currentTurn === undefined || !turnCompleted(currentTurn));
  const phase = session?.executionPhase;
  const preparing =
    session?.executionBackend === "docker" &&
    phase !== undefined &&
    ["checking", "preparing_image", "preparing_state", "starting"].includes(phase);
  const waiting = working && (awaitingInput || (session?.pendingApprovals ?? 0) > 0);
  const turnAnchors = useMemo(
    () => findTurnAnchors(presentedNodes, turns),
    [presentedNodes, turns],
  );
  // A reconnect can confirm an active turn without supplying its start time.
  // Scope activity to the latest user message without inventing a duration.
  const latestUserIndex = presentedNodes.reduce(
    (last, node, index) => (node.kind === "user" ? index : last),
    -1,
  );
  const turnStart =
    currentTurn && !(working && turnCompleted(currentTurn))
      ? (turnAnchors.get(currentTurn.id) ??
        (currentTurn.firstNodeKey ? latestUserIndex + 1 : presentedNodes.length))
      : latestUserIndex + 1;
  const currentStart = Math.max(turnStart, latestUserIndex + 1);
  const activeNodes = currentStart < 0 ? [] : presentedNodes.slice(currentStart);
  const latestContent = [...activeNodes]
    .reverse()
    .find((node) => ["tool", "thinking", "assistant"].includes(node.kind));
  const runningTool =
    working &&
    latestContent?.kind === "tool" &&
    activeNodes.some(
      (node) => node.kind === "tool" && ["running", "pending", "waiting"].includes(node.status),
    );
  const streamingKey =
    working && !waiting && latestContent?.kind === "assistant" && latestContent.streaming
      ? presentationKey(latestContent)
      : undefined;
  const thinkingKey =
    working && !waiting && !runningTool && latestContent?.kind === "thinking"
      ? presentationKey(latestContent)
      : undefined;
  let activityLabel: string | undefined;
  if (preparing && !working) {
    activityLabel = t(
      phase === "starting" && session?.executionBackend === "docker"
        ? "core.transcript.preparation.starting_docker"
        : `core.transcript.preparation.${phase}`,
    );
  } else if (session.nativeTurnCompacting && session.working && !waiting) {
    activityLabel = t("core.transcript.compacting");
  } else if (!working && session?.awaitingResponse) {
    activityLabel = t("core.transcript.thinking");
  } else if (waiting) {
    activityLabel = t(
      awaitingInput ? "core.transcript.waiting_answer" : "core.transcript.waiting_approval",
    );
  } else if (
    working &&
    !runningTool &&
    !thinkingKey &&
    !(latestContent?.kind === "assistant" && latestContent.streaming)
  ) {
    activityLabel = session?.nativeTurnNotice || t("core.transcript.thinking");
  }
  const nodes = useMemo<TranscriptRow[]>(() => {
    const rows: TranscriptRow[] = [];
    const anchored = new Set<string>();
    const turnsAt = new Map<number, TurnWork[]>();
    for (const turn of turns) {
      const index = turnAnchors.get(turn.id);
      if (index === undefined) continue;
      const at = turnsAt.get(index) ?? [];
      at.push(turn);
      turnsAt.set(index, at);
    }
    const unknownStart =
      working &&
      (!currentTurn ||
        turnCompleted(currentTurn) ||
        (currentTurn.firstNodeKey !== undefined && !turnAnchors.has(currentTurn.id)));
    const grouped = groupActivities(
      presentedNodes,
      working,
      currentStart,
      new Set(turnAnchors.values()),
      fileSummaryAllowed,
    );
    for (const row of grouped) {
      if (row.kind !== "files") {
        if (unknownStart && row.index === latestUserIndex + 1)
          rows.push({ kind: "unknown-work", key: "unknown-work" });
        for (const turn of turnsAt.get(row.index) ?? []) {
          rows.push({ kind: "turn", turn, key: `turn:${turn.id}` });
          anchored.add(turn.id);
        }
      }
      rows.push(row);
    }
    // An observed turn can precede its first visible content. Never invent timing
    // for older history that did not supply lifecycle timestamps.
    for (const turn of turns) {
      if (
        !anchored.has(turn.id) &&
        (!turn.firstNodeKey || turnAnchors.get(turn.id) === presentedNodes.length)
      )
        rows.push({ kind: "turn", turn, key: `turn:${turn.id}` });
    }
    if (unknownStart && latestUserIndex + 1 >= presentedNodes.length)
      rows.push({ kind: "unknown-work", key: "unknown-work" });
    if (activityLabel && rows.at(-1)?.kind !== "group")
      rows.push({ kind: "activity", label: activityLabel, key: "current-activity" });
    if (hasCommandHistory) rows.push({ kind: "commands", key: "native-command-history" });
    return rows;
  }, [
    hasCommandHistory,
    presentedNodes,
    turns,
    turnAnchors,
    activityLabel,
    working,
    currentTurn,
    latestUserIndex,
    currentStart,
    fileSummaryAllowed,
  ]);

  const [viewportSize, setViewportSize] = useState(0);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportSize(element.clientHeight));
    observer.observe(element);
    setViewportSize(element.clientHeight);
    return () => observer.disconnect();
  }, [scrollRef]);
  // Breathing room is part of the virtual layout, so the follow target remains
  // the actual scroll end and measurements/history anchoring use one coordinate system.
  const endSpace = Math.round(viewportSize * 0.35);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: nodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(
      (index: number) => {
        const node = nodes[index];
        return node?.kind === "node" ? estimateNodeHeight(node.node) : 36;
      },
      [nodes],
    ),
    getItemKey: useCallback(
      (index: number) => {
        const node = nodes[index];
        if (node === undefined) {
          return `missing-${index}`;
        }
        return node.key;
      },
      [nodes],
    ),
    overscan: OVERSCAN,
    useFlushSync: false,
    paddingStart: 24,
    paddingEnd: endSpace,
    // Anchor at response time, including user movement while a page was loading.
    // The virtualizer also compensates measured heights without a second DOM scroll writer.
    anchorTo: "end",
    // An explicit pause (e.g. opening a tool) must also disable resize pinning.
    scrollEndThreshold: following ? FOLLOW_THRESHOLD_PX : -1,
  });

  const refreshForRead = useCallback(
    () => feed.loadHistory(sessionId, { refresh: true, preserveOlder: true }),
    [feed, sessionId],
  );
  useConversationRead({
    sessionId,
    viewport: scrollRef,
    latestIndex: nodes.length - 1,
    refresh: refreshForRead,
  });

  const totalSize = virtualizer.getTotalSize();
  const viewportHeight = virtualizer.scrollRect?.height;
  useLayoutEffect(() => {
    if (!followRef.current) {
      const element = scrollRef.current;
      if (element)
        setShowJump(
          totalSize - endSpace - element.scrollTop - element.clientHeight > FOLLOW_THRESHOLD_PX,
        );
      return;
    }
    // Reconcile after the sizer grows as well as after new nodes arrive. A
    // measurement correction issued before that commit can be browser-clamped.
    virtualizer.scrollToEnd();
  }, [nodes, totalSize, endSpace, viewportHeight, virtualizer, scrollRef]);

  const requestHistory = useCallback((): void => {
    if (historyLoadingRef.current || historyExhausted || historyUnavailable) {
      return;
    }
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    void feed.loadHistory(sessionId).finally(() => {
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    });
  }, [historyExhausted, historyUnavailable, sessionId, feed]);

  useEffect(() => {
    let cancelled = false;
    feed.ensureSession(sessionId, harness);
    // New sessions already have their complete transcript in the live feed.
    // Read after ensureSession, which publishes the initial history flags.
    if (transcriptStore.getState().transcripts[sessionId]?.historyExhausted) return;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    void feed.loadHistory(sessionId).finally(() => {
      if (cancelled) return;
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    });
    return () => {
      cancelled = true;
      historyLoadingRef.current = false;
    };
  }, [sessionId, harness, feed]);

  const previousScrollTop = useRef(0);
  const resumeOnScroll = useRef(false);
  const touchY = useRef<number | null>(null);
  const pauseFollow = useCallback(() => {
    followRef.current = false;
    resumeOnScroll.current = false;
    setFollowing(false);
    const element = scrollRef.current;
    if (element)
      setShowJump(
        totalSize - endSpace - element.scrollTop - element.clientHeight > FOLLOW_THRESHOLD_PX,
      );
  }, [totalSize, endSpace, scrollRef]);
  const scrollTowardLatest = useCallback(() => {
    resumeOnScroll.current = true;
    const element = scrollRef.current;
    if (
      element &&
      element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD_PX
    ) {
      followRef.current = true;
      setFollowing(true);
      setShowJump(false);
    }
  }, [scrollRef]);
  const handleScroll = useCallback((): void => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const distanceFromEnd = element.scrollHeight - element.scrollTop - element.clientHeight;
    // Upward movement pauses immediately, even inside the end threshold.
    // Content growth/resize must never be mistaken for user intent to pause.
    if (
      element.scrollTop < previousScrollTop.current - 1 &&
      distanceFromEnd > FOLLOW_THRESHOLD_PX
    ) {
      followRef.current = false;
    }
    if (!followRef.current && resumeOnScroll.current && distanceFromEnd <= FOLLOW_THRESHOLD_PX) {
      followRef.current = true;
      resumeOnScroll.current = false;
    }
    previousScrollTop.current = element.scrollTop;
    const follow = followRef.current;
    setFollowing(follow);
    setShowJump(
      !follow &&
        totalSize - endSpace - element.scrollTop - element.clientHeight > FOLLOW_THRESHOLD_PX,
    );
    if (!follow && element.scrollTop < Math.max(TOP_THRESHOLD_PX, element.clientHeight * 1.5)) {
      requestHistory();
    }
  }, [requestHistory, totalSize, endSpace, scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (
      element === null ||
      historyLoading ||
      sourceNodes === EMPTY_NODES ||
      prefetchedNodesRef.current === sourceNodes
    )
      return;
    // Continue through sparse pages and prefetch another page if the viewport
    // is still near the loaded boundary, even when no new scroll event fires.
    if (
      element.scrollHeight <= element.clientHeight ||
      (!followRef.current &&
        element.scrollTop < Math.max(TOP_THRESHOLD_PX, element.clientHeight * 1.5))
    ) {
      prefetchedNodesRef.current = sourceNodes;
      requestHistory();
    }
  }, [sourceNodes, historyLoading, requestHistory, scrollRef]);

  const jumpToLatest = useCallback((): void => {
    followRef.current = true;
    setFollowing(true);
    setShowJump(false);
    virtualizer.scrollToEnd();
  }, [virtualizer]);

  return (
    <DisclosureContext.Provider value={expansion}>
      <div className={`transcript${reduced ? " transcript--compact" : ""}`}>
        {historyLoading ? (
          <div className="transcript-status transcript-status-top" role="status">
            <LoaderCircle size={12} className="transcript-spin" aria-hidden="true" />
            <span>{t("core.transcript.loading_history")}</span>
          </div>
        ) : null}
        <div
          className="transcript-viewport"
          ref={scrollRef}
          onScroll={handleScroll}
          tabIndex={0}
          onWheel={(event) => {
            if (event.deltaY < 0) pauseFollow();
            else if (event.deltaY > 0) scrollTowardLatest();
          }}
          onTouchStart={(event) => {
            touchY.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(event) => {
            const y = event.touches[0]?.clientY;
            if (y !== undefined && touchY.current !== null) {
              if (y > touchY.current) pauseFollow();
              else if (y < touchY.current) scrollTowardLatest();
              touchY.current = y;
            }
          }}
          onPointerDown={(event) => {
            const viewport = event.currentTarget;
            if (
              event.target === viewport &&
              event.clientX >=
                viewport.getBoundingClientRect().right -
                  Math.max(16, viewport.offsetWidth - viewport.clientWidth)
            ) {
              pauseFollow();
              resumeOnScroll.current = true;
            }
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (
              ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
              (event.key === " " && event.shiftKey)
            )
              pauseFollow();
            if (
              ["ArrowDown", "PageDown", "End"].includes(event.key) ||
              (event.key === " " && !event.shiftKey)
            )
              scrollTowardLatest();
          }}
          onClickCapture={(event) => {
            if (event.target instanceof Element && event.target.closest(".tr-disclosure-toggle")) {
              pauseFollow();
            }
          }}
        >
          <div
            className="transcript-inner"
            style={{ height: `${totalSize}px`, position: "relative", width: "100%" }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const node = nodes[item.index];
              if (node === undefined) {
                return null;
              }
              return (
                <div
                  key={item.key}
                  className="transcript-item"
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {node.kind === "files" ? (
                    <ChangedFiles nodes={node.nodes} scope={node.key} />
                  ) : node.kind === "group" ? (
                    <DisclosureKeyContext.Provider value={node.key}>
                      <ActivityGroup
                        nodes={node.nodes}
                        sessionId={sessionId}
                        completedSummary={node.summary}
                        active={node.active && !waiting}
                        label={node.active && waiting ? activityLabel : undefined}
                      />
                    </DisclosureKeyContext.Provider>
                  ) : node.kind === "turn" ? (
                    <WorkingIndicator
                      turn={node.turn}
                      running={working && node.turn === currentTurn}
                    />
                  ) : node.kind === "unknown-work" ? (
                    <WorkingIndicator />
                  ) : node.kind === "activity" ? (
                    <ActivityIndicator label={node.label} />
                  ) : node.kind === "commands" ? (
                    <CommandHistory
                      sessionId={sessionId}
                      transport={commands}
                      placement="transcript"
                      sync={false}
                    />
                  ) : (
                    <DisclosureKeyContext.Provider value={node.key}>
                      <TranscriptNodeRenderer
                        node={node.node}
                        sessionId={sessionId}
                        active={node.key === streamingKey}
                        thinkingActive={node.key === thinkingKey}
                      />
                    </DisclosureKeyContext.Provider>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="transcript-navigation">
          {showJump ? (
            <button type="button" className="transcript-jump" onClick={jumpToLatest}>
              <ArrowDown size={12} aria-hidden="true" />
              <span>{t("core.transcript.jump_to_latest")}</span>
            </button>
          ) : null}
        </div>
      </div>
    </DisclosureContext.Provider>
  );
}
