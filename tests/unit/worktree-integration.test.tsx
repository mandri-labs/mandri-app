import { StrictMode } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorktreeIntegration } from "@/features/sessions/WorktreeIntegration";
import { SessionComposer } from "@/features/transcript/SessionComposer";
import { sessionsStore, selectByProject, type SessionView } from "@/stores/sessions";
import { isSessionResumable, stopSessionAction } from "@/features/sessions/lifecycle";
import {
  previewIntegration,
  integrateWorktree,
  finishWorktree,
  resolveWorktree,
  type IntegrationPreview,
} from "@/daemon/rest/worktrees";
import { initI18n } from "@/i18n";

vi.mock("@/daemon/rest/worktrees", () => ({
  previewIntegration: vi.fn(),
  integrateWorktree: vi.fn(),
  finishWorktree: vi.fn(),
  resolveWorktree: vi.fn(),
}));
vi.mock("@/features/sessions/lifecycle", async (original) => ({
  ...(await original<object>()),
  stopSessionAction: vi.fn(),
}));
vi.mock("@/features/commands/CommandHistory", () => ({
  CommandHistory: () => <div>Commands</div>,
}));
vi.mock("@/features/transcript/Composer", () => ({
  Composer: () => <textarea aria-label="Composer" />,
}));

beforeAll(() => initI18n("en"));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  sessionsStore.setState({ sessions: {}, order: [] });
});

const session: SessionView = {
  id: "one",
  harness: "claude",
  state: "stopped",
  title: "Improve search",
  deleted: false,
  pendingApprovals: 0,
  nativeId: "native-one",
  projectPath: "/state/worktrees/one",
  worktree: {
    id: "feature",
    path: "/state/worktrees/one",
    repository: "/repo",
    source_path: "/repo",
    state: "ready",
  },
};
const review: IntegrationPreview = {
  branches: ["release", "trunk"],
  default_branch: "trunk",
  target: "trunk",
  token: "a".repeat(64),
  files: ["file.txt"],
  diff: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+changed\n",
  conflicts: [],
  target_dirty: false,
  strategy: "squash",
};
function row(state = "ready") {
  return {
    id: "one",
    harness: "claude",
    native_id: "native-one",
    title: "Improve search",
    state: "stopped",
    project_path: "/state/worktrees/one",
    created_at: 1,
    updated_at: 1,
    model: null,
    execution_backend: "host" as const,
    privacy_mode: "none" as const,
    policy_revision: 1,
    worktree: {
      ...session.worktree!,
      base_ref: "refs/heads/trunk",
      base_commit: "base",
      state,
      integrated_target: "trunk",
      integrated_commit: "1234567890",
    },
  };
}
async function prepare(value: IntegrationPreview = review, current = session) {
  vi.mocked(previewIntegration).mockResolvedValue(value);
  render(<WorktreeIntegration session={current} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await screen.findByLabelText("Destination branch");
}

it("groups execution worktrees under their original workspace without changing execution paths", () => {
  const ordinary = { ...session, id: "two", projectPath: "/repo", worktree: undefined };
  const groups = selectByProject({
    sessions: { one: session, two: ordinary },
    order: ["one", "two"],
    filters: {},
  });
  expect(groups).toHaveLength(1);
  expect(groups[0]?.project).toBe("/repo");
  expect(groups[0]?.sessions.find((item) => item.id === "one")?.projectPath).toBe(
    "/state/worktrees/one",
  );
});

it("reviews, integrates and cleans up a stopped session without stopping or resuming it", async () => {
  vi.mocked(integrateWorktree).mockResolvedValue(row());
  vi.mocked(finishWorktree).mockResolvedValue(row("closed"));
  await prepare();
  expect(stopSessionAction).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Destination branch" }).textContent).toBe("trunk");
  expect(screen.getByRole("region", { name: "Changes to integrate" }).textContent).toContain(
    "changed",
  );
  expect(integrateWorktree).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Integrate into trunk" }));
  await screen.findByText("Integrated into trunk · 12345678");
  expect(integrateWorktree).toHaveBeenCalledWith("one", review, "Improve search");
  expect(finishWorktree).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Finish and clean up" }));
  await waitFor(() =>
    expect(sessionsStore.getState().sessions.one?.worktree?.state).toBe("closed"),
  );
});

it("requires an explicit branch when no default is known and refreshes after changing strategy", async () => {
  await prepare({
    branches: ["release", "develop"],
    default_branch: null,
    target: null,
    token: null,
  });
  expect(screen.getByRole("button", { name: "Destination branch" }).textContent).toBe(
    "Choose a branch",
  );
  fireEvent.click(screen.getByRole("button", { name: "Destination branch" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "release" }));
  fireEvent.click(screen.getByRole("button", { name: "Integration method" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Merge · preserve commits" }));
  expect(
    (screen.getByRole("button", { name: "Integrate into release" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  vi.mocked(previewIntegration).mockResolvedValue({
    ...review,
    target: "release",
    strategy: "merge",
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));
  await waitFor(() =>
    expect(previewIntegration).toHaveBeenLastCalledWith("one", "release", "merge"),
  );
});

it("prepares conflicts in the worktree without integrating the target", async () => {
  vi.mocked(resolveWorktree).mockResolvedValue(undefined);
  const conflict = { ...review, conflicts: ["file.txt"] };
  await prepare(conflict);
  expect(screen.queryByRole("button", { name: "Integrate into trunk" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Prepare resolution in the session" }));
  await waitFor(() => expect(resolveWorktree).toHaveBeenCalledWith("one", conflict));
  expect(integrateWorktree).not.toHaveBeenCalled();
  await screen.findByText(/Conflicts prepared in the worktree/);
});

it("keeps cleaned conversations readable and removes command and prompt entry points", () => {
  const closed = { ...session, worktree: { ...session.worktree!, state: "closed" } };
  sessionsStore.setState({ sessions: { one: closed } });
  render(<SessionComposer sessionId="one" />);
  expect(screen.queryByLabelText("Composer")).toBeNull();
  expect(screen.queryByText("Commands")).toBeNull();
  expect(screen.getByText("Integrated · worktree cleaned")).toBeTruthy();
  expect(isSessionResumable(closed).resumable).toBe(false);
});

it.each(["idle", "active"] as const)(
  "opens the dialog but blocks review while a writer owns the session (%s)",
  (activity) => {
    render(<WorktreeIntegration session={{ ...session, state: "live", activity }} />);
    fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Prepare review" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(stopSessionAction).not.toHaveBeenCalled();
    expect(previewIntegration).not.toHaveBeenCalled();
  },
);

it("reviews and integrates an unowned session despite its stale live record without stopping it", async () => {
  sessionsStore.setState({
    sessions: {
      one: {
        ...session,
        state: "live",
        activity: "idle",
        availability: {
          owner: "unowned",
          activity: "idle",
          can_resume: true,
          can_release: false,
          can_restore: true,
        },
      },
    },
  });
  vi.mocked(previewIntegration).mockResolvedValue(review);
  vi.mocked(integrateWorktree).mockResolvedValue(row());
  render(<SessionComposer sessionId="one" />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  expect(screen.queryByText("Stop the session before integrating changes.")).toBeNull();
  await screen.findByLabelText("Destination branch");
  fireEvent.click(screen.getByRole("button", { name: "Integrate into trunk" }));
  await screen.findByText("Integrated into trunk · 12345678");
  expect(integrateWorktree).toHaveBeenCalledWith("one", review, "Improve search");
  expect(stopSessionAction).not.toHaveBeenCalled();
});

it.each(["mandri", "external"] as const)(
  "blocks review when %s owns a session with a stale stopped record",
  (owner) => {
    render(
      <WorktreeIntegration
        session={{
          ...session,
          availability: {
            owner,
            activity: "idle",
            can_resume: false,
            can_release: true,
            can_restore: false,
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
    expect(
      (screen.getByRole("button", { name: "Prepare review" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(stopSessionAction).not.toHaveBeenCalled();
  },
);

it("allows a stopped session with leftover activity flags to prepare its review", async () => {
  await prepare(review, {
    ...session,
    activity: "active",
    nativeTurnActive: true,
    awaitingResponse: true,
    sending: true,
    pendingApprovals: 1,
    externalBusy: true,
  });
  expect(previewIntegration).toHaveBeenCalledWith("one", undefined, "squash");
  expect(stopSessionAction).not.toHaveBeenCalled();
});

it("loads the review on opening, shows progress, and enables integration without a preparation click", async () => {
  let complete!: (value: IntegrationPreview) => void;
  vi.mocked(previewIntegration).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(
    <StrictMode>
      <WorktreeIntegration session={session} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  expect(previewIntegration).toHaveBeenCalledExactlyOnceWith("one", undefined, "squash");
  expect(screen.getByRole("status").textContent).toBe("Loading changes…");
  expect(screen.queryByRole("button", { name: "Integrate changes" })).toBeNull();
  expect(integrateWorktree).not.toHaveBeenCalled();
  complete(review);
  const integrate = await screen.findByRole("button", { name: "Integrate into trunk" });
  expect((integrate as HTMLButtonElement).disabled).toBe(false);
  expect(previewIntegration).toHaveBeenCalledTimes(1);
});

it("shows a failed automatic review and allows retrying it", async () => {
  vi.mocked(previewIntegration)
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue(review);
  render(<WorktreeIntegration session={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await screen.findByRole("alert");
  expect(previewIntegration).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Prepare review" }));
  await screen.findByLabelText("Destination branch");
  expect(previewIntegration).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("automatically loads when availability confirms that the session is unowned", async () => {
  vi.mocked(previewIntegration).mockResolvedValue(review);
  const current = { ...session, state: "live" as const };
  const { rerender } = render(<WorktreeIntegration session={current} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  expect(previewIntegration).not.toHaveBeenCalled();
  rerender(
    <WorktreeIntegration
      session={{
        ...current,
        availability: {
          owner: "unowned",
          activity: "idle",
          can_resume: true,
          can_release: false,
          can_restore: true,
        },
      }}
    />,
  );
  await screen.findByLabelText("Destination branch");
  expect(previewIntegration).toHaveBeenCalledTimes(1);
  expect(stopSessionAction).not.toHaveBeenCalled();
});

it("blocks integration if the session resumes after opening the review", async () => {
  vi.mocked(previewIntegration).mockResolvedValue(review);
  const { rerender } = render(<WorktreeIntegration session={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await screen.findByLabelText("Destination branch");
  rerender(<WorktreeIntegration session={{ ...session, state: "live", activity: "idle" }} />);
  const integrate = screen.getByRole("button", { name: "Integrate into trunk" });
  expect((integrate as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(integrate);
  expect(integrateWorktree).not.toHaveBeenCalled();
  expect(stopSessionAction).not.toHaveBeenCalled();
});

it("keeps the review and draft through fullscreen and per-file disclosure changes", async () => {
  await prepare();
  const header = screen.getByRole("button", { name: /file.txt Modified/ });
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByRole("navigation", { name: "Changed files" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Commit message"), {
    target: { value: "Reviewed change" },
  });
  fireEvent.click(header);
  expect(screen.queryByRole("region", { name: "file.txt" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand to full screen" }));
  expect(screen.getByRole("navigation", { name: "Changed files" })).toBeTruthy();
  expect(header.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
  expect(screen.queryByRole("navigation", { name: "Changed files" })).toBeNull();
  fireEvent.click(header);
  expect(screen.getByRole("region", { name: "file.txt" })).toBeTruthy();
  expect((screen.getByLabelText("Commit message") as HTMLInputElement).value).toBe(
    "Reviewed change",
  );
  expect(previewIntegration).toHaveBeenCalledTimes(1);
  expect(integrateWorktree).not.toHaveBeenCalled();
});

it("supports keyboard selection and closes only the dropdown on Escape", async () => {
  await prepare();
  const trigger = screen.getByRole("button", { name: "Destination branch" });
  fireEvent.click(trigger);
  const first = screen.getByRole("menuitemradio", { name: "release" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: /trunk/ }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("dialog", { name: "Integrate changes" })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  expect(integrateWorktree).not.toHaveBeenCalled();
});
