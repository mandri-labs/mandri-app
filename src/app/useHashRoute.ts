import { useEffect, useState } from "react";
import { panesStore, type PaneWorkspace } from "@/stores/panes";
import { parsePaneWorkspace, paneWorkspaceParams, workspaceForTarget } from "./panes/paneRoute";

export type Route =
  | { name: "dashboard"; cwd?: string; worktree?: boolean; surrogate?: boolean }
  | { name: "session"; id: string; workspace?: PaneWorkspace | null }
  | { name: "agent"; id: string; workspace?: PaneWorkspace | null }
  | { name: "providers" }
  | { name: "routes" }
  | { name: "usage"; sessionId?: string; projectPath?: string }
  | { name: "settings"; section?: "connection" | "mcp" };

export function parseHash(hash: string): Route {
  const [path = "", query] = hash.replace(/^#/, "").split("?");
  if (path === "" || path === "/") {
    const params = new URLSearchParams(query);
    const cwd = params.get("cwd");
    return {
      name: "dashboard",
      ...(cwd ? { cwd } : {}),
      ...(params.get("worktree") === "1" ? { worktree: true } : {}),
      ...(params.get("surrogate") === "1" ? { surrogate: true } : {}),
    };
  }
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const first = segments[0];
  const second = segments[1];
  switch (first) {
    case "agent":
    case "session":
      if (second !== undefined && second.length > 0) {
        const id = decodeURIComponent(second);
        const workspace = parsePaneWorkspace(new URLSearchParams(query), { kind: first, id });
        return { name: first, id, ...(workspace ? { workspace } : {}) };
      }
      return { name: "dashboard" };
    case "mcp":
      return { name: "settings", section: "mcp" };
    case "providers":
      return { name: "providers" };
    case "usage": {
      const params = new URLSearchParams(query);
      const sessionId = params.get("session_id");
      const projectPath = params.get("project_path");
      return sessionId
        ? { name: "usage", sessionId }
        : projectPath
          ? { name: "usage", projectPath }
          : { name: "usage" };
    }
    case "routes":
      return { name: "routes" };
    case "settings": {
      const section = new URLSearchParams(query).get("section");
      return section === "connection" || section === "mcp"
        ? { name: "settings", section }
        : { name: "settings" };
    }
    default:
      return { name: "dashboard" };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "dashboard": {
      const params = new URLSearchParams({
        ...(route.cwd ? { cwd: route.cwd } : {}),
        ...(route.worktree ? { worktree: "1" } : {}),
        ...(route.surrogate ? { surrogate: "1" } : {}),
      });
      return params.size ? `#/?${params}` : "#/";
    }
    case "session":
    case "agent": {
      const params = route.workspace ? paneWorkspaceParams(route.workspace) : undefined;
      const path = `#/${route.name}/${encodeURIComponent(route.id)}`;
      return params?.size ? `${path}?${params}` : path;
    }
    case "providers":
      return "#/providers";
    case "usage": {
      const params = new URLSearchParams(
        route.sessionId
          ? { session_id: route.sessionId }
          : route.projectPath
            ? { project_path: route.projectPath }
            : {},
      );
      return params.size ? `#/usage?${params}` : "#/usage";
    }
    case "routes":
      return "#/routes";
    case "settings":
      return route.section ? `#/settings?section=${route.section}` : "#/settings";
  }
}

export function routeTitleKey(route: Route): string {
  return `core.route.${route.name}`;
}

export function withPaneWorkspace(route: Route): Route {
  if ((route.name !== "session" && route.name !== "agent") || route.workspace !== undefined)
    return route;
  const workspace = workspaceForTarget(panesStore.getState(), { kind: route.name, id: route.id });
  return workspace ? { ...route, workspace } : route;
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(withPaneWorkspace(route));
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}
