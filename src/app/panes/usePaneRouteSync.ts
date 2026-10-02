import { useEffect, useLayoutEffect, useRef } from "react";
import { paneKey, panesStore, type PaneTarget, type PaneWorkspace } from "@/stores/panes";
import { parseHash, routeToHash } from "@/app/useHashRoute";
import { closeSessionPane, retainPaneTarget, retainSingleView } from "./targets";

/** The URL owns composition; metadata and native feeds may arrive after restoration. */
export function usePaneRouteSync(
  target: PaneTarget | undefined,
  workspace: PaneWorkspace | null | undefined,
): void {
  const applying = useRef(false);
  const kind = target?.kind;
  const id = target?.id;
  const enabled = workspace !== undefined;

  useLayoutEffect(() => {
    if (!enabled || !kind || !id) return;
    applying.current = true;
    try {
      const active = { kind, id };
      const state = panesStore.getState();
      if (!workspace) {
        if (!state.panes.length) return;
        retainSingleView(active);
        for (const pane of [...state.panes]) closeSessionPane(pane.sessionId);
        return;
      }
      const next = workspace.targets.map((target) => ({
        sessionId: paneKey(target),
        target,
        focused: paneKey(target) === paneKey(active),
      }));
      const samePanes =
        next.length === state.panes.length &&
        next.every(
          (pane, index) =>
            pane.sessionId === state.panes[index]?.sessionId &&
            pane.focused === state.panes[index]?.focused,
        );
      if (
        samePanes &&
        state.splitRatio === workspace.splitRatio &&
        state.rowRatio === (workspace.rowRatio ?? 50) &&
        state.maximizedPane === (workspace.maximized ? paneKey(workspace.maximized) : null)
      )
        return;
      for (const pane of [...state.panes])
        if (!next.some((item) => item.sessionId === pane.sessionId))
          closeSessionPane(pane.sessionId);
      for (const item of next) retainPaneTarget(item.target);
      panesStore.setState({
        panes: next,
        splitRatio: workspace.splitRatio,
        rowRatio: workspace.rowRatio ?? 50,
        maximizedPane: workspace.maximized ? paneKey(workspace.maximized) : null,
        layout: next.length > 2 ? "grid" : next.length === 2 ? "split" : "single",
      });
    } finally {
      applying.current = false;
    }
  }, [enabled, kind, id, workspace]);

  useEffect(() => {
    if (!enabled) return;
    const sync = () => {
      if (applying.current) return;
      const route = parseHash(window.location.hash);
      // Settings remains an overlay, and non-conversation pages retain their own URL.
      if (route.name !== "session" && route.name !== "agent") return;
      const state = panesStore.getState();
      const active = state.panes.find((pane) => pane.focused)?.target;
      const hash = routeToHash({
        name: active?.kind ?? route.name,
        id: active?.id ?? route.id,
        workspace: state.panes.length
          ? {
              targets: state.panes.map((pane) => pane.target),
              splitRatio: state.splitRatio,
              rowRatio: state.rowRatio,
              ...(state.maximizedPane && active ? { maximized: active } : {}),
            }
          : null,
      });
      if (hash === window.location.hash) return;
      const oldURL = window.location.href;
      window.history.replaceState(window.history.state, "", hash);
      // replaceState does not emit hashchange; keep every router consumer in sync.
      window.dispatchEvent(
        new HashChangeEvent("hashchange", { oldURL, newURL: window.location.href }),
      );
    };
    const unsubscribe = panesStore.subscribe(sync);
    sync();
    return unsubscribe;
  }, [enabled]);
}
