import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import { targetKey, type CanvasTarget } from "./targets";
export interface CanvasTab {
  id: string;
  target: CanvasTarget;
  revision: number;
}
export interface CanvasSession {
  tabs: CanvasTab[];
  active?: string;
  open: boolean;
  expanded: boolean;
  width: number;
}
export const emptyCanvas: CanvasSession = { tabs: [], open: false, expanded: false, width: 50 };
export const canvasStore = createStore(() => ({ sessions: {} as Record<string, CanvasSession> }));
export function updateCanvas(sessionId: string, update: (state: CanvasSession) => CanvasSession) {
  canvasStore.setState(({ sessions }) => ({
    sessions: { ...sessions, [sessionId]: update(sessions[sessionId] ?? emptyCanvas) },
  }));
}
export function openCanvas(sessionId: string, target: CanvasTarget) {
  const id = targetKey(target);
  updateCanvas(sessionId, (state) => {
    const previous = state.tabs.find((tab) => tab.id === id);
    const tab = { id, target, revision: (previous?.revision ?? 0) + 1 };
    return {
      ...state,
      open: true,
      active: id,
      tabs: previous
        ? state.tabs.map((item) => (item.id === id ? tab : item))
        : [...state.tabs, tab],
    };
  });
}
export function closeCanvasTab(sessionId: string, id: string) {
  updateCanvas(sessionId, (state) => {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    return {
      ...state,
      tabs,
      active: state.active === id ? tabs[Math.min(index, tabs.length - 1)]?.id : state.active,
      open: tabs.length > 0 && state.open,
    };
  });
}
daemonIdentity.subscribe(() => canvasStore.setState({ sessions: {} }));
