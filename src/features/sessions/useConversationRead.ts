import { connectionStore } from "@/stores/connection";
import { useEffect, useRef, type RefObject } from "react";
import { useStore } from "@/app/useStore";
import { daemonIdentity } from "@/daemon/identity";
import { isUnread, type ConversationTarget } from "@/daemon/types/conversationStatus";
import { agentsStore } from "@/stores/agents";
import { conversationStatusStore } from "@/stores/conversationStatus";
import { panesStore } from "@/stores/panes";
import { transcriptStore } from "@/stores/sessions";
import { readConversation } from "./readConversation";

export function canReadConversation(viewport: HTMLElement, latestIndex: number): boolean {
  if (
    document.hidden ||
    !document.hasFocus() ||
    !viewport.isConnected ||
    viewport.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  const pane = viewport.closest(".pane");
  if (pane && !pane.classList.contains("pane--focused")) return false;
  if (
    Array.from(
      document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="menu"]'),
    ).some((overlay) => overlay.getBoundingClientRect().width > 0)
  )
    return false;
  const rect = viewport.getBoundingClientRect();
  let bottom = Math.min(rect.bottom, window.innerHeight);
  let top = Math.max(rect.top, 0);
  let left = Math.max(rect.left, 0);
  let right = Math.min(rect.right, window.innerWidth);
  for (let ancestor = viewport.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    const clip = ancestor.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
  }
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight ||
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 4
  )
    return false;
  const latest = viewport.querySelector(`[data-index="${latestIndex}"]`);
  if (!latest) return false;
  const end = latest.getBoundingClientRect();
  return (
    end.height > 0 &&
    end.bottom > top &&
    end.bottom <= bottom + 1 &&
    right > left &&
    end.right > left &&
    end.left < right
  );
}

export function useConversationRead({
  sessionId,
  viewport,
  latestIndex,
  refresh,
}: {
  sessionId: string;
  viewport: RefObject<HTMLDivElement | null>;
  latestIndex: number;
  refresh: () => Promise<void>;
}) {
  const linked = useStore(agentsStore, (state) =>
    sessionId.startsWith("agent:") ? state.agents[sessionId.slice(6)]?.session_id : undefined,
  );
  const target: ConversationTarget = linked
    ? `session:${linked}`
    : sessionId.startsWith("agent:")
      ? (sessionId as ConversationTarget)
      : `session:${sessionId}`;
  const status = useStore(conversationStatusStore, (state) => state.statuses[target]);
  const transcript = useStore(transcriptStore, (state) => state.transcripts[sessionId]);
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const connection = useStore(connectionStore, (state) => state.status);
  const refreshed = useRef<string | undefined>(undefined);
  const attempted = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!status || !isUnread(status) || status.work_state !== "idle" || connection !== "online")
      return;
    const key = `${generation}:${target}:${status.completion_revision}`;
    if (
      transcript?.loadedCompletionRevision === status.completion_revision &&
      transcript.loadedCompletionTarget === target
    )
      return;
    if (refreshed.current === key) return;
    refreshed.current = key;
    void refresh()
      .finally(() => {
        const current = transcriptStore.getState().transcripts[sessionId];
        if (
          current?.loadedCompletionRevision !== status.completion_revision ||
          current.loadedCompletionTarget !== target
        )
          refreshed.current = undefined;
      })
      .catch(() => {
        refreshed.current = undefined;
      });
  }, [
    status,
    transcript?.loadedCompletionRevision,
    transcript?.loadedCompletionTarget,
    generation,
    target,
    refresh,
    connection,
    sessionId,
  ]);

  useEffect(() => {
    const element = viewport.current;
    if (
      !element ||
      !status?.completion_key ||
      !isUnread(status) ||
      status.work_state !== "idle" ||
      transcript?.loadedCompletionTarget !== target ||
      transcript.loadedCompletionRevision !== status.completion_revision ||
      transcript.gapFlag ||
      transcript.historyUnavailable ||
      !transcript.nodes.length ||
      transcript.pendingUsers?.length ||
      connection !== "online"
    )
      return;
    const latestContent = [...transcript.nodes]
      .reverse()
      .find((node) => node.kind === "assistant" || node.kind === "tool");
    if (
      (latestContent?.kind === "assistant" && latestContent.streaming) ||
      (latestContent?.kind === "tool" &&
        ["running", "pending", "waiting"].includes(latestContent.status))
    )
      return;
    let animation: number | undefined;
    const key = `${generation}:${target}:${status.completion_revision}`;
    const check = () => {
      animation = undefined;
      if (attempted.current === key || !canReadConversation(element, latestIndex)) return;
      attempted.current = key;
      void readConversation(target, status.completion_revision, status.completion_key!).catch(
        () => {
          attempted.current = undefined;
        },
      );
    };
    const schedule = () => {
      if (animation === undefined) animation = requestAnimationFrame(check);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "inert", "aria-hidden", "class"],
    });
    const unsubscribe = panesStore.subscribe(schedule);
    window.addEventListener("resize", schedule);
    element.addEventListener("scroll", schedule);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    schedule();
    return () => {
      if (animation !== undefined) cancelAnimationFrame(animation);
      resize.disconnect();
      mutations.disconnect();
      unsubscribe();
      window.removeEventListener("resize", schedule);
      element.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [status, transcript, target, generation, latestIndex, viewport, connection]);
}
