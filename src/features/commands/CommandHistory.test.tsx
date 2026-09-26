import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { initI18n } from "@/i18n";
import type { CommandInvocation } from "@/daemon/types/commands";
import { sessionsStore } from "@/stores/sessions";
import { CommandHistory } from "./CommandHistory";
import { commandDismissals } from "./dismissals";
import { commandsStore, reconcileCommands, rememberCommand } from "./store";

const goal = (state: CommandInvocation["state"], id = "goal-1"): CommandInvocation => ({
  invocation_id: id, session_id: "s", command: { id: "goal", name: "goal", kind: "command", description: "Objective", aliases: [] },
  arguments: "Check the workspace", state, cancellable: false,
});
beforeAll(async () => { await initI18n("en"); });
beforeEach(() => {
  sessionsStore.setState({ sessions: { s: { id: "s", harness: "claude", state: "live", title: "Test", deleted: false, pendingApprovals: 0 } } });
  commandsStore.setState({ sessions: {} });
  commandDismissals.setState({ hidden: {} });
});
afterEach(cleanup);

it.each(["running", "unknown"] as const)("does not close a %s command in a live session", (state) => {
  rememberCommand(goal(state));
  render(<CommandHistory sessionId="s" placement="composer" sync={false} />);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});

it.each(["succeeded", "failed", "interrupted"] as const)("can dismiss a %s card without deleting it or restoring it during reconciliation", (state) => {
  const record = goal(state);
  rememberCommand(record);
  render(<CommandHistory sessionId="s" placement="composer" sync={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("article")).toBeNull();
  act(() => reconcileCommands("s", [record]));
  expect(screen.queryByRole("article")).toBeNull();
  expect(commandsStore.getState().sessions.s).toEqual([record]);
  act(() => rememberCommand(goal("running", "goal-2")));
  expect(screen.getByRole("article")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});

it("makes close available only after a running session stops", () => {
  rememberCommand(goal("running"));
  render(<CommandHistory sessionId="s" placement="composer" sync={false} />);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  act(() => sessionsStore.getState().applySessionPatch("s", { state: "stopped" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("article")).toBeNull();
});

it("keeps one pinned goal when an older execution receives a late update", () => {
  rememberCommand(goal("running", "old"));
  rememberCommand(goal("running", "new"));
  rememberCommand(goal("succeeded", "old"));
  render(<CommandHistory sessionId="s" placement="composer" sync={false} />);
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Running")).toBeTruthy();
});
