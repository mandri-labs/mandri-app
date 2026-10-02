import { Columns2, Maximize2, Minimize2, Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { ENTER_SPLIT_EVENT } from "@/app/keyboard";
import { AgentView } from "@/features/agents/AgentView";
import { SessionView } from "@/features/transcript/SessionView";
import { agentsStore } from "@/stores/agents";
import { sessionsStore } from "@/stores/sessions";
import {
  panesStore,
  paneKey,
  MAX_PANES,
  type Pane,
  type PaneTarget,
  type PaneWorkspace,
} from "@/stores/panes";
import { closeSessionPane, enterSplitMode, openTargetPane, retainSingleView } from "./targets";
import { PaneIdentity } from "./PaneIdentity";
import { PanePicker } from "./PanePicker";
import { PaneDivider } from "./PaneDivider";
import { usePaneRouteSync } from "./usePaneRouteSync";
import { ShellHeaderActions } from "@/app/ShellHeaderActions";
import { CanvasReopenButton } from "@/features/canvas/CanvasReopenButton";
import "./panes.css";

export { openSessionPane, closeSessionPane } from "./targets";

function ConversationPane({
  pane,
  onActivate,
  onClose,
  onAdd,
  showHeader,
  hidden,
  maximized,
  onMaximize,
  savedSize,
}: {
  pane: Pane;
  onActivate?: (target: PaneTarget) => void;
  onClose: (key: string) => void;
  onAdd: () => void;
  showHeader: boolean;
  hidden: boolean;
  maximized: boolean;
  onMaximize: (key: string) => void;
  savedSize?: { width: number; height: number };
}) {
  const { t } = useTranslation();
  const section = useRef<HTMLElement>(null);
  const session = useStore(sessionsStore, (state) =>
    pane.target.kind === "session" ? state.sessions[pane.target.id] : undefined,
  );
  const agent = useStore(agentsStore, (state) =>
    pane.target.kind === "agent" ? state.agents[pane.target.id] : undefined,
  );
  const title = agent?.title ?? session?.title ?? pane.target.id;
  const openPanes = useStore(panesStore, (state) => state.panes);
  const openAgentIds = openPanes
    .filter((item) => item.target.kind === "agent")
    .map((item) => item.target.id);
  useEffect(() => {
    if (pane.focused && !section.current?.contains(document.activeElement))
      section.current?.focus({ preventScroll: true });
  }, [pane.focused]);
  const focus = (event: SyntheticEvent) => {
    if (event.target instanceof Element) {
      const control = event.target.closest(".pane-header button");
      // Switching canvases on pointerdown can move the button before its click lands.
      if (control && (control.classList.contains("pane-close") || event.type !== "click"))
        return;
    }
    if (panesStore.getState().panes.find((item) => item.sessionId === pane.sessionId)?.focused)
      return;
    panesStore.getState().focusPane(pane.sessionId);
    onActivate?.(pane.target);
  };
  return (
    <section
      ref={section}
      className={`pane${pane.focused ? " pane--focused" : ""}`}
      aria-label={title}
      tabIndex={-1}
      hidden={hidden}
      aria-hidden={hidden || undefined}
      inert={hidden}
      data-pane-key={pane.sessionId}
      style={hidden && savedSize ? { width: savedSize.width, height: savedSize.height } : undefined}
      onFocusCapture={focus}
      onPointerDownCapture={focus}
      onClickCapture={focus}
    >
      {showHeader && (
        <header className="pane-header">
          <div className="pane-controls">
            <button
              type="button"
              className="pane-icon-button"
              aria-label={t("core.panes.add")}
              disabled={openPanes.length >= MAX_PANES}
              title={
                openPanes.length >= MAX_PANES
                  ? t("core.panes.limit", { count: MAX_PANES })
                  : t("core.panes.add")
              }
              onClick={onAdd}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            <CanvasReopenButton sessionId={pane.sessionId} className="pane-icon-button" />
            <button
              type="button"
              className="pane-icon-button"
              aria-label={t(maximized ? "core.panes.restore" : "core.panes.maximize", { title })}
              title={t(maximized ? "core.panes.restore" : "core.panes.maximize", { title })}
              onClick={() => {
                onMaximize(pane.sessionId);
                onActivate?.(pane.target);
              }}
            >
              {maximized ? (
                <Minimize2 size={14} aria-hidden="true" />
              ) : (
                <Maximize2 size={14} aria-hidden="true" />
              )}
            </button>
          </div>
          <PaneIdentity target={pane.target} />
          <button
            type="button"
            className="pane-icon-button pane-close"
            aria-label={t("core.panes.close", { title })}
            title={t("core.panes.close", { title })}
            onClick={() => onClose(pane.sessionId)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
      )}
      <div className="pane-body">
        {pane.target.kind === "agent" ? (
          <AgentView agentId={pane.target.id} feedReason="pane" />
        ) : (
          <SessionView
            sessionId={pane.target.id}
            feedReason="pane"
            excludeAgentApprovals={openAgentIds}
          />
        )}
      </div>
    </section>
  );
}

export interface PaneManagerProps {
  children?: ReactNode;
  deepLinkId?: string;
  target?: PaneTarget;
  onActivate?: (target: PaneTarget) => void;
  workspace?: PaneWorkspace | null;
}

export function PaneManager({
  children,
  deepLinkId,
  target,
  onActivate,
  workspace,
}: PaneManagerProps) {
  const { t } = useTranslation();
  const panes = useStore(panesStore, (state) => state.panes);
  const ratio = useStore(panesStore, (state) => state.splitRatio);
  const rowRatio = useStore(panesStore, (state) => state.rowRatio);
  const maximizedPane = useStore(panesStore, (state) => state.maximizedPane);
  const multiple = panes.length > 1;
  const grid = useRef<HTMLDivElement>(null);
  const savedViews = useRef(
    new Map<string, { width: number; height: number; scrollTop: number }>(),
  );
  const previousMaximized = useRef(maximizedPane);
  const maximize = (key: string) => {
    if (!panesStore.getState().maximizedPane) {
      savedViews.current.clear();
      for (const pane of grid.current?.querySelectorAll<HTMLElement>(".pane") ?? []) {
        const box = pane.getBoundingClientRect();
        savedViews.current.set(pane.dataset.paneKey!, {
          width: box.width,
          height: box.height,
          scrollTop: pane.querySelector(".transcript-viewport")?.scrollTop ?? 0,
        });
      }
    }
    panesStore.getState().toggleMaximize(key);
  };
  useLayoutEffect(() => {
    if (previousMaximized.current && !maximizedPane) {
      const restore = () => {
        for (const pane of grid.current?.querySelectorAll<HTMLElement>(".pane") ?? []) {
          const viewport = pane.querySelector<HTMLElement>(".transcript-viewport");
          const saved = savedViews.current.get(pane.dataset.paneKey!);
          if (viewport && saved) viewport.scrollTop = saved.scrollTop;
        }
      };
      restore();
      // Resize observers remeasure virtualized rows after layout is restored.
      const frame = requestAnimationFrame(restore);
      previousMaximized.current = maximizedPane;
      return () => cancelAnimationFrame(frame);
    }
    previousMaximized.current = maximizedPane;
  }, [maximizedPane]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = target ?? (deepLinkId ? { kind: "session" as const, id: deepLinkId } : undefined);
  const currentKey = current && paneKey(current);
  usePaneRouteSync(current, workspace);
  const currentRef = useRef(current);
  currentRef.current = current;
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  const close = (key: string) => {
    const state = panesStore.getState();
    if (state.panes.length === 1 && state.panes[0]?.sessionId === key)
      retainSingleView(state.panes[0].target);
    closeSessionPane(key);
    const focused = panesStore.getState().panes.find((pane) => pane.focused);
    if (focused) activateRef.current?.(focused.target);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (workspace !== undefined) return;
    if (previous.current === currentKey) return;
    previous.current = currentKey;
    const next = currentRef.current;
    const state = panesStore.getState();
    if (!next || !state.panes.length) return;
    if (state.panes.some((pane) => pane.sessionId === paneKey(next)))
      state.focusPane(paneKey(next));
    else {
      const focused = state.panes.find((pane) => pane.focused);
      if (focused) closeSessionPane(focused.sessionId);
      openTargetPane(next);
    }
  }, [currentKey, workspace]);
  useEffect(() => {
    const split = () => enterSplitMode(currentRef.current);
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return;
      const state = panesStore.getState();
      const pane = state.panes[Number(event.key) - 1];
      if (pane && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        state.focusPane(pane.sessionId);
        activateRef.current?.(pane.target);
        return;
      }
      if (event.key.toLowerCase() !== "w") return;
      const focused = state.panes.find((item) => item.focused);
      if (focused) {
        event.preventDefault();
        closeRef.current(focused.sessionId);
      }
    };
    window.addEventListener(ENTER_SPLIT_EVENT, split);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener(ENTER_SPLIT_EVENT, split);
      window.removeEventListener("keydown", keydown);
    };
  }, []);
  const choose = (next: PaneTarget) => {
    if (!panesStore.getState().panes.length && currentRef.current)
      openTargetPane(currentRef.current);
    if (!openTargetPane(next)) return;
    setPickerOpen(false);
    onActivate?.(next);
  };
  const leave = () => {
    const focused = panesStore.getState().panes.find((pane) => pane.focused)?.target;
    if (focused) retainSingleView(focused);
    for (const pane of [...panesStore.getState().panes]) closeSessionPane(pane.sessionId);
    if (focused) onActivate?.(focused);
  };
  return (
    <div className={`pane-workspace${panes.length ? " pane-workspace--split" : ""}`}>
      {!multiple && (
        <ShellHeaderActions>
          <div className="pane-header-controls">
            <button
              type="button"
              className="shell-icon-button"
              aria-label={t(panes.length ? "core.panes.add" : "core.panes.open")}
              disabled={panes.length >= MAX_PANES}
              title={
                panes.length >= MAX_PANES
                  ? t("core.panes.limit", { count: MAX_PANES })
                  : t(panes.length ? "core.panes.add" : "core.panes.open")
              }
              onClick={() => {
                setPickerOpen(true);
              }}
            >
              {panes.length ? (
                <Plus size={16} aria-hidden="true" />
              ) : (
                <Columns2 size={16} aria-hidden="true" />
              )}
            </button>
            {panes.length > 0 && (
              <button
                type="button"
                className="shell-icon-button"
                aria-label={t("core.panes.single")}
                title={t("core.panes.single")}
                onClick={leave}
              >
                <Maximize2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </ShellHeaderActions>
      )}
      {panes.length ? (
        <div
          ref={grid}
          className={`panes panes--${panes.length > 2 ? "grid" : panes.length === 2 ? "split" : "single"}${maximizedPane ? " panes--maximized" : ""}`}
          style={
            panes.length > 1
              ? ({
                  gridTemplateColumns: `minmax(0, ${ratio}fr) minmax(0, ${100 - ratio}fr)`,
                  "--pane-row-ratio": rowRatio / 100,
                } as CSSProperties)
              : undefined
          }
        >
          {panes.map((pane) => (
            <ConversationPane
              key={pane.sessionId}
              pane={pane}
              onActivate={onActivate}
              onClose={close}
              onAdd={() => setPickerOpen(true)}
              showHeader={multiple}
              hidden={!!maximizedPane && maximizedPane !== pane.sessionId}
              maximized={maximizedPane === pane.sessionId}
              onMaximize={maximize}
              savedSize={savedViews.current.get(pane.sessionId)}
            />
          ))}
          {panes.length > 1 && !maximizedPane && <PaneDivider />}
          {panes.length > 2 && !maximizedPane && <PaneDivider orientation="horizontal" />}
        </div>
      ) : (
        children
      )}
      {pickerOpen && (
        <PanePicker
          currentTarget={!panes.length ? currentRef.current : undefined}
          onSelect={choose}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
