import { afterEach, expect, it } from "vitest";
import { navigate, parseHash, routeToHash, withPaneWorkspace } from "@/app/useHashRoute";
import { panesStore, type PaneWorkspace } from "@/stores/panes";

afterEach(() => {
  panesStore.getState().closeAll();
  window.history.replaceState(null, "", "#/");
});

it("round-trips a mixed workspace, panel order, active agent and ratio through the URL", () => {
  const workspace: PaneWorkspace = {
    targets: [
      { kind: "session", id: "parent / ? & +" },
      { kind: "agent", id: "child:one" },
      { kind: "agent", id: "nested/reviewer" },
      { kind: "session", id: "other" },
    ],
    splitRatio: 62.5,
    rowRatio: 57.5,
  };
  const route = { name: "agent" as const, id: "child:one", workspace };
  workspace.maximized = { kind: "agent", id: "child:one" };
  expect(parseHash(routeToHash(route))).toEqual(route);
});

it("ignores maximization of a missing or inactive target", () => {
  for (const zoom of ["agent:missing", "session:other", "session:root"]) {
    const hash =
      zoom === "session:root"
        ? "#/session/root?pane=session:root"
        : "#/session/root?pane=session:root&pane=session:other";
    const route = parseHash(`${hash}&zoom=${zoom}`);
    expect(route.name === "session" && route.workspace?.maximized).toBeUndefined();
  }
});

it("keeps existing clean session, agent and dashboard links compatible", () => {
  expect(parseHash("#/session/root")).toEqual({ name: "session", id: "root" });
  expect(parseHash("#/agent/child")).toEqual({ name: "agent", id: "child" });
  const route = { name: "dashboard" as const, cwd: "/workspace", worktree: true };
  expect(parseHash(routeToHash(route))).toEqual(route);
});

it("restores a single framed panel as a workspace and defaults its ratio", () => {
  expect(parseHash("#/session/root?pane=session%3Aroot")).toEqual({
    name: "session",
    id: "root",
    workspace: { targets: [{ kind: "session", id: "root" }], splitRatio: 50 },
  });
});

it("ignores invalid targets and duplicates without confusing sessions and agents", () => {
  const route = parseHash(
    "#/session/root?pane=invalid&pane=other%3Aid&pane=agent%3A&pane=session%3Aroot&pane=session%3Aroot&pane=agent%3Aroot",
  );
  expect(route).toEqual({
    name: "session",
    id: "root",
    workspace: {
      targets: [
        { kind: "session", id: "root" },
        { kind: "agent", id: "root" },
      ],
      splitRatio: 50,
    },
  });
});

it.each([
  ["abc", 50],
  ["Infinity", 50],
  ["", 50],
  ["10", 30],
  ["95", 70],
])("normalizes invalid or out-of-bounds ratios: %s", (ratio, expected) => {
  const route = parseHash(`#/session/root?pane=session%3Aroot&split=${ratio}`);
  expect(route.name === "session" && route.workspace?.splitRatio).toBe(expected);
  const rows = parseHash(`#/session/root?pane=session%3Aroot&rows=${ratio}`);
  expect(rows.name === "session" && rows.workspace?.rowRatio).toBe(expected);
});

it("limits restored panels to four while retaining the active target", () => {
  const route = parseHash(
    "#/agent/active?pane=session:a&pane=session:b&pane=session:c&pane=session:d&pane=session:e",
  );
  expect(route.name === "agent" && route.workspace?.targets).toEqual([
    { kind: "agent", id: "active" },
    { kind: "session", id: "a" },
    { kind: "session", id: "b" },
    { kind: "session", id: "c" },
  ]);
});

it("keeps composition when navigating to an existing panel and replaces only the active slot otherwise", () => {
  panesStore.getState().openPane("first");
  panesStore.getState().openPane("second");
  panesStore.getState().setRowRatio(65);
  const existing = withPaneWorkspace({ name: "session", id: "first" });
  expect(existing.name === "session" && existing.workspace?.targets).toEqual([
    { kind: "session", id: "first" },
    { kind: "session", id: "second" },
  ]);
  const next = withPaneWorkspace({ name: "agent", id: "child" });
  expect(next.name === "agent" && next.workspace?.targets).toEqual([
    { kind: "session", id: "first" },
    { kind: "agent", id: "child" },
  ]);
  expect(next.name === "agent" && next.workspace?.rowRatio).toBe(65);
});

it("writes navigation with its workspace and supports an explicit single-view link", () => {
  panesStore.getState().openPane("root");
  panesStore.getState().openTarget({ kind: "agent", id: "child" });
  navigate({ name: "agent", id: "child" });
  expect(parseHash(window.location.hash)).toEqual({
    name: "agent",
    id: "child",
    workspace: {
      targets: [
        { kind: "session", id: "root" },
        { kind: "agent", id: "child" },
      ],
      splitRatio: 50,
    },
  });
  navigate({ name: "agent", id: "child", workspace: null });
  expect(window.location.hash).toBe("#/agent/child");
});
