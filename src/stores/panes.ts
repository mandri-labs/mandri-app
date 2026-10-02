import { createStore } from "zustand/vanilla";

export type PaneLayout = "single" | "split" | "grid";

export type PaneRejectionReason = "max_panes";

export interface Pane {
  sessionId: string;
  target: PaneTarget;
  focused: boolean;
}

export type PaneTarget = { kind: "session" | "agent"; id: string };

export interface PaneWorkspace {
  targets: PaneTarget[];
  splitRatio: number;
  rowRatio?: number;
  maximized?: PaneTarget;
}

export function paneKey(target: PaneTarget): string {
  return target.kind === "agent" ? `agent:${target.id}` : target.id;
}

export const MAX_PANES = 4;

export interface PanesState {
  panes: Pane[];
  layout: PaneLayout;
  splitRatio: number;
  rowRatio: number;
  maximizedPane: string | null;
  lastActionRejected?: PaneRejectionReason;
  openPane: (sessionId: string) => boolean;
  openTarget: (target: PaneTarget) => boolean;
  closePane: (sessionId: string) => void;
  focusPane: (sessionId: string) => void;
  setLayout: (layout: PaneLayout) => void;
  setSplitRatio: (ratio: number) => void;
  setRowRatio: (ratio: number) => void;
  toggleMaximize: (key: string) => void;
  closeAll: () => void;
}

function layoutForPaneCount(count: number, current: PaneLayout): PaneLayout {
  if (count >= 3) {
    return "grid";
  }
  if (count === 2) {
    return "split";
  }
  return current;
}

export const panesStore = createStore<PanesState>()((set, get) => ({
  panes: [],
  layout: "single",
  splitRatio: 50,
  rowRatio: 50,
  maximizedPane: null,
  openPane: (sessionId) => get().openTarget({ kind: "session", id: sessionId }),
  openTarget: (target) => {
    const sessionId = paneKey(target);
    const existing = get().panes.find((pane) => pane.sessionId === sessionId);
    if (existing) {
      set((state) => ({
        lastActionRejected: undefined,
        maximizedPane: state.maximizedPane ? sessionId : null,
        panes: state.panes.map((pane) => ({
          ...pane,
          focused: pane.sessionId === sessionId,
        })),
      }));
      return true;
    }
    if (get().panes.length >= MAX_PANES) {
      set({ lastActionRejected: "max_panes" });
      return false;
    }
    set((state) => {
      const panes = [
        ...state.panes.map((pane) => ({ ...pane, focused: false })),
        { sessionId, target, focused: true },
      ];
      return {
        panes,
        maximizedPane: null,
        layout: layoutForPaneCount(panes.length, state.layout),
        lastActionRejected: undefined,
      };
    });
    return true;
  },
  closePane: (sessionId) => {
    const { panes } = get();
    const target = panes.find((pane) => pane.sessionId === sessionId);
    if (!target) {
      return;
    }
    const remaining = panes.filter((pane) => pane.sessionId !== sessionId);
    const nextPanes =
      target.focused && remaining.length > 0
        ? remaining.map((pane, index) => ({
            ...pane,
            focused: index === 0,
          }))
        : remaining;
    set({
      panes: nextPanes,
      maximizedPane:
        remaining.length < 2 || get().maximizedPane === sessionId ? null : get().maximizedPane,
      lastActionRejected: undefined,
    });
  },
  focusPane: (sessionId) => {
    set((state) => {
      if (
        !state.panes.some((pane) => pane.sessionId === sessionId) ||
        state.panes.some((pane) => pane.sessionId === sessionId && pane.focused)
      ) {
        return state;
      }
      return {
        lastActionRejected: undefined,
        maximizedPane: state.maximizedPane ? sessionId : null,
        panes: state.panes.map((pane) => ({
          ...pane,
          focused: pane.sessionId === sessionId,
        })),
      };
    });
  },
  setLayout: (layout) => {
    set({ layout });
  },
  setSplitRatio: (ratio) => {
    if (Number.isFinite(ratio)) set({ splitRatio: Math.max(30, Math.min(70, ratio)) });
  },
  setRowRatio: (ratio) => {
    if (Number.isFinite(ratio)) set({ rowRatio: Math.max(30, Math.min(70, ratio)) });
  },
  toggleMaximize: (key) => {
    const state = get();
    if (state.panes.length < 2 || !state.panes.some((pane) => pane.sessionId === key)) return;
    set({
      maximizedPane: state.maximizedPane === key ? null : key,
      panes: state.panes.map((pane) => ({ ...pane, focused: pane.sessionId === key })),
    });
  },
  closeAll: () => {
    set({
      panes: [],
      layout: "single",
      splitRatio: 50,
      rowRatio: 50,
      maximizedPane: null,
      lastActionRejected: undefined,
    });
  },
}));
