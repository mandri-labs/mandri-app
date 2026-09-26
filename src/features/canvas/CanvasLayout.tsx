import { ReadingPane } from "./ReadingPane";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X, Maximize2, Minimize2, PanelRightOpen } from "lucide-react";
import { useStore } from "@/app/useStore";
import { canvasStore, emptyCanvas, updateCanvas, closeCanvasTab } from "./store";
import { FileView } from "./FileView";
import "./canvas.css";

export function CanvasLayout({
  sessionId: selectedSessionId,
  children,
}: {
  sessionId?: string;
  children: ReactNode;
}) {
  const sessionId = selectedSessionId ?? "";
  const { t } = useTranslation();
  const state = useStore(canvasStore, (value) => value.sessions[sessionId] ?? emptyCanvas);
  const root = useRef<HTMLDivElement>(null);
  const width = (value: number) =>
    updateCanvas(sessionId, (current) => ({
      ...current,
      width: Math.max(30, Math.min(75, value)),
    }));
  return (
    <div
      ref={root}
      className={`canvas-layout ${state.open ? "canvas-is-open" : ""} ${state.open && state.expanded ? "canvas-is-expanded" : ""}`}
    >
      <div className="canvas-chat">{children}</div>
      {!state.open && state.tabs.length > 0 && (
        <button
          className="canvas-reopen"
          aria-label={t("core.canvas.open")}
          title={t("core.canvas.open")}
          onClick={() => updateCanvas(sessionId, (current) => ({ ...current, open: true }))}
        >
          <PanelRightOpen size={18} />
        </button>
      )}
      {state.open && (
        <>
          <div
            className="canvas-divider"
            role="separator"
            aria-label={t("core.canvas.resize")}
            aria-orientation="vertical"
            aria-valuenow={state.width}
            aria-valuemin={30}
            aria-valuemax={75}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                width(state.width + (event.key === "ArrowLeft" ? 2 : -2));
              }
            }}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                const rect = root.current!.getBoundingClientRect();
                width(((rect.right - event.clientX) / rect.width) * 100);
              }
            }}
          />
          <aside
            className="canvas-panel"
            aria-label={t("core.canvas.title")}
            style={{ width: `${state.width}%` }}
            onKeyDown={(event) => {
              if (event.key === "Escape")
                updateCanvas(sessionId, (current) => ({ ...current, open: false }));
            }}
          >
            <div className="canvas-header">
              <div
                className="canvas-tabs"
                role="tablist"
                aria-label={t("core.canvas.title")}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const tabs = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                  );
                  const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
                  const next =
                    tabs[
                      (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
                    ];
                  next?.click();
                  next?.focus();
                }}
              >
                {state.tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`canvas-tab ${tab.id === state.active ? "active" : ""}`}
                  >
                    <button
                      role="tab"
                      tabIndex={tab.id === state.active ? 0 : -1}
                      aria-selected={tab.id === state.active}
                      title={
                        tab.target.kind === "excerpt"
                          ? tab.target.title
                          : (tab.target.path ?? tab.target.title)
                      }
                      onClick={() =>
                        updateCanvas(sessionId, (current) => ({ ...current, active: tab.id }))
                      }
                    >
                      {tab.target.title}
                    </button>
                    <button
                      aria-label={`${t("core.canvas.close_tab")} ${tab.target.title}`}
                      onClick={() => closeCanvasTab(sessionId, tab.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                aria-label={t(state.expanded ? "core.canvas.restore" : "core.canvas.expand")}
                onClick={() =>
                  updateCanvas(sessionId, (current) => ({
                    ...current,
                    expanded: !current.expanded,
                  }))
                }
              >
                {state.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                aria-label={t("core.canvas.close")}
                onClick={() => updateCanvas(sessionId, (current) => ({ ...current, open: false }))}
              >
                <X size={18} />
              </button>
            </div>
            {state.tabs.map((tab) => (
              <ReadingPane
                key={`${sessionId}:${tab.id}`}
                id={`${sessionId}:${tab.id}`}
                title={tab.target.title}
                active={state.active === tab.id}
              >
                <FileView sessionId={sessionId} tab={tab} />
              </ReadingPane>
            ))}
          </aside>
        </>
      )}
    </div>
  );
}
