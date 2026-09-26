import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ProtectionMenu } from "@/features/sessions/ProtectionMenu";
import { SessionProtection } from "@/features/sessions/SessionProtection";
import {
  choicePolicy,
  policyFromWire,
  permitsNative,
  type ProtectionChoice,
} from "@/daemon/protection";
import { initI18n } from "@/i18n";
import { renameWorktree } from "@/daemon/rest/sessions";
import { sessionsStore, type SessionView } from "@/stores/sessions";

vi.mock("@/features/sessions/executionStatus", () => ({ useExecutionStatus: vi.fn() }));
vi.mock("@/daemon/rest/sessions", () => ({ getSession: vi.fn(), renameWorktree: vi.fn() }));

beforeAll(() => initI18n("en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Menu() {
  const [choice, setChoice] = useState<ProtectionChoice>("standard");
  const [name, setName] = useState("");
  return (
    <ProtectionMenu
      value={choice}
      onSelect={setChoice}
      worktreeId={name}
      onWorktreeIdChange={setName}
    />
  );
}

it("keeps pseudonymization independent and makes Docker and worktree mutually exclusive", () => {
  render(<Menu />);
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: /^Worktree/ }));
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  expect(screen.getByPlaceholderText("Random name")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "feature/search" } });
  fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("button", { name: /^Worktree/ }).getAttribute("aria-pressed")).toBe(
    "false",
  );
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /^Worktree/ }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("feature/search");
});

it("allows native models in worktrees and preserves worktree evidence across execution updates", () => {
  expect(choicePolicy("worktree_surrogate")).toEqual({
    execution_backend: "host",
    privacy_mode: "surrogate",
    worktree: true,
  });
  const worktree = {
    id: "calm-jade-otter",
    path: "/state/worktrees/one",
    source_path: "/repo",
    repository: "/repo",
  };
  const previous = policyFromWire({
    execution_backend: "host",
    privacy_mode: "none",
    policy_revision: 1,
    worktree,
  });
  expect(permitsNative(previous)).toBe(true);
  expect(
    policyFromWire(
      { execution_backend: "host", privacy_mode: "none", policy_revision: 1 },
      previous,
    ).worktree,
  ).toEqual(worktree);
});

it("shows the actual name returned after a rename collision without changing the session path", async () => {
  const worktree = {
    id: "calm-jade-otter",
    path: "/state/worktrees/one",
    source_path: "/repo",
    repository: "/repo",
  };
  const session: SessionView = {
    id: "one",
    harness: "claude",
    state: "stopped",
    title: "Task",
    deleted: false,
    pendingApprovals: 0,
    executionBackend: "host",
    privacyMode: "none",
    policyConfirmed: true,
    worktree,
  };
  vi.mocked(renameWorktree).mockResolvedValue({
    id: "one",
    harness: "claude",
    state: "stopped",
    native_id: null,
    title: "Task",
    project_path: worktree.path,
    created_at: 1,
    updated_at: 1,
    model: null,
    execution_backend: "host",
    privacy_mode: "none",
    policy_revision: 1,
    worktree: {
      ...worktree,
      id: "bright-amber-fox",
      base_ref: "refs/heads/main",
      base_commit: "abc",
    },
  });
  render(<SessionProtection session={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  const input = screen.getAllByRole("textbox")[0]!;
  fireEvent.change(input, { target: { value: "taken" } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(renameWorktree).toHaveBeenCalledWith("one", "taken"));
  expect((await screen.findByRole("status")).textContent).toContain("bright-amber-fox");
  expect(sessionsStore.getState().sessions.one?.worktree?.path).toBe(worktree.path);
});
