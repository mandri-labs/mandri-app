import { createStore } from "zustand/vanilla";

export type PaneLayout = "single" | "split" | "grid";

export type PaneRejectionReason = "max_panes";

export interface Pane {
  sessionId: string;
  focused: boolean;
}

export const MAX_PANES = 4;

export interface PanesState {
  panes: Pane[];
  layout: PaneLayout;
  lastActionRejected?: PaneRejectionReason;
  openPane: (sessionId: string) => boolean;
  closePane: (sessionId: string) => void;
  focusPane: (sessionId: string) => void;
  setLayout: (layout: PaneLayout) => void;
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
  openPane: (sessionId) => {
    const existing = get().panes.find((pane) => pane.sessionId === sessionId);
    if (existing) {
      set((state) => ({
        lastActionRejected: undefined,
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
        { sessionId, focused: true },
      ];
      return {
        panes,
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
    set({ panes: nextPanes, lastActionRejected: undefined });
  },
  focusPane: (sessionId) => {
    set((state) => {
      if (!state.panes.some((pane) => pane.sessionId === sessionId)) {
        return state;
      }
      return {
        lastActionRejected: undefined,
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
  closeAll: () => {
    set({ panes: [], lastActionRejected: undefined });
  },
}));
