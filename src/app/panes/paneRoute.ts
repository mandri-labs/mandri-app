import {
  MAX_PANES,
  paneKey,
  type PaneTarget,
  type PaneWorkspace,
  type PanesState,
} from "@/stores/panes";

function parseRatio(value: string | null): number {
  const ratio = value !== null && value.trim() !== "" ? Number(value) : 50;
  return Number.isFinite(ratio) ? Math.max(30, Math.min(70, ratio)) : 50;
}

export function parsePaneWorkspace(
  params: URLSearchParams,
  active: PaneTarget,
): PaneWorkspace | undefined {
  const targets: PaneTarget[] = [];
  const keys = new Set<string>();
  for (const value of params.getAll("pane")) {
    const separator = value.indexOf(":");
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (separator < 0 || (kind !== "session" && kind !== "agent") || !id) continue;
    const target: PaneTarget = { kind, id };
    const key = paneKey(target);
    if (keys.has(key)) continue;
    targets.push(target);
    keys.add(key);
    if (targets.length === MAX_PANES) break;
  }
  if (!targets.length) return undefined;
  if (!keys.has(paneKey(active))) targets.unshift(active);
  const maximized =
    targets.length > 1 && params.get("zoom") === `${active.kind}:${active.id}` ? active : undefined;
  return {
    targets: targets.slice(0, MAX_PANES),
    splitRatio: parseRatio(params.get("split")),
    ...(params.has("rows") ? { rowRatio: parseRatio(params.get("rows")) } : {}),
    ...(maximized ? { maximized } : {}),
  };
}

export function paneWorkspaceParams(workspace: PaneWorkspace): URLSearchParams {
  const params = new URLSearchParams();
  for (const target of workspace.targets) params.append("pane", `${target.kind}:${target.id}`);
  if (workspace.splitRatio !== 50)
    params.set("split", String(Math.round(workspace.splitRatio * 100) / 100));
  if (workspace.rowRatio !== undefined && workspace.rowRatio !== 50)
    params.set("rows", String(Math.round(workspace.rowRatio * 100) / 100));
  if (workspace.maximized)
    params.set("zoom", `${workspace.maximized.kind}:${workspace.maximized.id}`);
  return params;
}

export function workspaceForTarget(
  state: Pick<PanesState, "panes" | "splitRatio" | "rowRatio" | "maximizedPane">,
  target: PaneTarget,
): PaneWorkspace | undefined {
  if (!state.panes.length) return undefined;
  const targets = state.panes.map((pane) => pane.target);
  if (!targets.some((item) => paneKey(item) === paneKey(target))) {
    const focused = state.panes.findIndex((pane) => pane.focused);
    targets[Math.max(0, focused)] = target;
  }
  return {
    targets,
    splitRatio: state.splitRatio,
    ...(state.rowRatio !== 50 ? { rowRatio: state.rowRatio } : {}),
    ...(state.maximizedPane ? { maximized: target } : {}),
  };
}
