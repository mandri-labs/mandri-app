import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import i18n, { initI18n } from "@/i18n";
import { DaemonError } from "@/daemon/errors";
import { getSessionAvailability } from "@/daemon/rest/availability";
import { daemonIdentity } from "@/daemon/identity";

vi.mock("@/daemon/rest/availability", () => ({ getSessionAvailability: vi.fn() }));
const free = {
  owner: "unowned" as const,
  activity: "idle" as const,
  can_resume: true,
  can_release: false,
  can_restore: false,
};
function StoreBackedIntegration({ session }: { session: SessionView }) {
  useLayoutEffect(() => {
    sessionsStore.setState({ sessions: { [session.id]: session }, order: [session.id] });
  }, [session]);
  return <WorktreeIntegration session={session} />;
}

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
beforeEach(() => {
  daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
  vi.mocked(getSessionAvailability).mockResolvedValue(free);
});
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
  render(<StoreBackedIntegration session={current} />);
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
  await screen.findByText("Commit 12345678 added to trunk.");
  expect(integrateWorktree).toHaveBeenCalledWith("one", review, "Improve search");
  expect(finishWorktree).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  await waitFor(() =>
    expect(sessionsStore.getState().sessions.one?.worktree?.state).toBe("closed"),
  );
  expect(finishWorktree).toHaveBeenCalledWith("one", false);
});

it("revalidates a stopped session's cached Mandri owner and opens the review without stopping again", async () => {
  await prepare(review, {
    ...session,
    availability: { ...free, owner: "mandri", can_resume: false },
    availabilityStatus: "stale",
  });
  expect(getSessionAvailability).toHaveBeenCalledWith("one");
  expect(previewIntegration).toHaveBeenCalledTimes(1);
  expect(stopSessionAction).not.toHaveBeenCalled();
  expect(
    screen.queryByText(
      "Mandri still controls this session. Stop or release its process before integrating.",
    ),
  ).toBeNull();
});

it("explains unknown ownership and allows an immediate availability retry after a failed lookup", async () => {
  vi.mocked(getSessionAvailability).mockRejectedValueOnce(new Error("Unavailable"));
  vi.mocked(previewIntegration).mockResolvedValue(review);
  render(
    <StoreBackedIntegration session={{ ...session, availability: { ...free, owner: "mandri" } }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await screen.findByText(
    "Session ownership could not be verified. Check availability before integrating.",
  );
  expect(
    screen.queryByText(
      "Mandri still controls this session. Stop or release its process before integrating.",
    ),
  ).toBeNull();
  expect(previewIntegration).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check session availability" }));
  await screen.findByLabelText("Destination branch");
  expect(getSessionAvailability).toHaveBeenCalledTimes(2);
});

it("rechecks ownership before integrating and refuses a writer that appeared after review", async () => {
  await prepare();
  vi.mocked(getSessionAvailability).mockResolvedValueOnce({
    ...free,
    owner: "external",
    can_resume: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Integrate into trunk" }));
  await screen.findByText(
    "Another application owns this session. Release it there, then check availability again.",
  );
  expect(integrateWorktree).not.toHaveBeenCalled();
});

it("rejects an ownership response started before stop and lets the dialog recheck the stopped session", async () => {
  let finish!: (value: Awaited<ReturnType<typeof getSessionAvailability>>) => void;
  vi.mocked(getSessionAvailability).mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  vi.mocked(previewIntegration).mockResolvedValue(review);
  render(<StoreBackedIntegration session={{ ...session, state: "live" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await act(async () => {
    sessionsStore.getState().applySessionPatch("one", { state: "stopped", stopRevision: 1 });
    finish({ ...free, owner: "mandri" });
  });
  await screen.findByText(
    "Session ownership could not be verified. Check availability before integrating.",
  );
  expect(previewIntegration).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check session availability" }));
  await screen.findByLabelText("Destination branch");
  expect(sessionsStore.getState().sessions.one?.availability?.owner).toBe("unowned");
});

it("reopens an already integrated TestWorkspace-shaped session and finishes only after ignored-file consent", async () => {
  const current = {
    ...session,
    worktree: {
      ...session.worktree!,
      id: "TestWorkspace",
      integrated_target: "master",
      integrated_commit: "a21bf707synthetic",
    },
    availability: { ...free, owner: "mandri" as const },
    availabilityStatus: "stale" as const,
  };
  vi.mocked(finishWorktree)
    .mockRejectedValueOnce(new DaemonError({ code: "worktree_ignored_files", message: "Ignored" }))
    .mockResolvedValue(row("closed"));
  vi.mocked(previewIntegration).mockResolvedValue({ ...review, target: "master", files: [] });
  render(<StoreBackedIntegration session={current} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await screen.findByText("Commit a21bf707 added to master.");
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  const consent = await screen.findByRole("checkbox", { name: /Delete all files ignored by Git/ });
  await waitFor(() => expect((consent as HTMLInputElement).disabled).toBe(false));
  expect((consent as HTMLInputElement).checked).toBe(false);
  expect(finishWorktree).toHaveBeenLastCalledWith("one", false);
  fireEvent.click(consent);
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  await waitFor(() => expect(finishWorktree).toHaveBeenLastCalledWith("one", true));
  expect(integrateWorktree).not.toHaveBeenCalled();
  expect(getSessionAvailability).toHaveBeenCalledTimes(3);
});

it("offers ignored-file deletion after cleanup is blocked and requires checking it", async () => {
  vi.mocked(integrateWorktree).mockResolvedValue(row());
  vi.mocked(finishWorktree)
    .mockRejectedValueOnce(new DaemonError({ code: "worktree_ignored_files", message: "Ignored" }))
    .mockRejectedValueOnce(new DaemonError({ code: "worktree_ignored_files", message: "Ignored" }))
    .mockResolvedValue(row("closed"));
  await prepare();
  fireEvent.click(screen.getByRole("button", { name: "Integrate into trunk" }));
  await screen.findByText("Commit 12345678 added to trunk.");
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  const checkbox = await screen.findByRole("checkbox", { name: /Delete all files ignored by Git/ });
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole("alert").textContent).toContain("Your changes are integrated");
  expect(finishWorktree).toHaveBeenLastCalledWith("one", false);
  await waitFor(() => expect((checkbox as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  await waitFor(() => expect(finishWorktree).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((checkbox as HTMLInputElement).disabled).toBe(false));
  expect(finishWorktree).toHaveBeenLastCalledWith("one", false);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  await waitFor(() =>
    expect(sessionsStore.getState().sessions.one?.worktree?.state).toBe("closed"),
  );
  expect(finishWorktree).toHaveBeenLastCalledWith("one", true);
});

it("reopens an integrated session on its destination even when another branch is the default", async () => {
  const current = {
    ...session,
    worktree: {
      ...session.worktree!,
      integrated_target: "release",
      integrated_commit: "abcdef1234",
    },
  };
  vi.mocked(previewIntegration).mockResolvedValue({ ...review, target: "release", files: [] });
  vi.mocked(finishWorktree).mockResolvedValue(row("closed"));
  render(<StoreBackedIntegration session={current} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await screen.findByText("Commit abcdef12 added to release.");
  expect(previewIntegration).toHaveBeenCalledWith("one", "release", "squash");
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  await waitFor(() => expect(finishWorktree).toHaveBeenCalledWith("one", false));
  expect(integrateWorktree).not.toHaveBeenCalled();
});

it("requires an explicit branch when no default is known and previews destination and method changes automatically", async () => {
  await prepare({
    branches: ["release", "develop"],
    default_branch: null,
    target: null,
    token: null,
  });
  expect(screen.getByRole("button", { name: "Destination branch" }).textContent).toBe(
    "Choose a branch",
  );
  vi.mocked(previewIntegration).mockResolvedValue({ ...review, target: "release" });
  fireEvent.click(screen.getByRole("button", { name: "Destination branch" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "release" }));
  await waitFor(() =>
    expect(previewIntegration).toHaveBeenLastCalledWith("one", "release", "squash"),
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Integrate into release" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  vi.mocked(previewIntegration).mockResolvedValue({
    ...review,
    target: "release",
    strategy: "merge",
  });
  fireEvent.click(screen.getByRole("button", { name: "Integration method" }));
  expect(screen.getByRole("menuitemradio", { name: "Squash" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Merge" }));
  await waitFor(() =>
    expect(previewIntegration).toHaveBeenLastCalledWith("one", "release", "merge"),
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Integrate into release" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});

it("keeps the latest destination and method preview when older requests finish out of order", async () => {
  await prepare();
  let release!: (value: IntegrationPreview) => void;
  let trunk!: (value: IntegrationPreview) => void;
  let merged!: (value: IntegrationPreview) => void;
  vi.mocked(previewIntegration)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          trunk = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          merged = resolve;
        }),
    );
  fireEvent.click(screen.getByRole("button", { name: "Destination branch" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "release" }));
  await waitFor(() =>
    expect(previewIntegration).toHaveBeenLastCalledWith("one", "release", "squash"),
  );
  expect(screen.getByRole("region", { name: "Changes to integrate" }).textContent).toContain(
    "changed",
  );
  expect(
    (screen.getByRole("button", { name: "Integrate into release" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Destination branch" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /^trunk/ }));
  await waitFor(() =>
    expect(previewIntegration).toHaveBeenLastCalledWith("one", "trunk", "squash"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Integration method" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Merge" }));
  await waitFor(() => expect(previewIntegration).toHaveBeenLastCalledWith("one", "trunk", "merge"));
  await act(async () =>
    merged({
      ...review,
      strategy: "merge",
      token: "b".repeat(64),
      diff: review.diff?.replace("changed", "latest"),
    }),
  );
  await act(async () =>
    trunk({
      ...review,
      token: "d".repeat(64),
      diff: review.diff?.replace("changed", "old method"),
    }),
  );
  await act(async () =>
    release({
      ...review,
      target: "release",
      token: "c".repeat(64),
      diff: review.diff?.replace("changed", "outdated"),
    }),
  );
  expect(screen.getByRole("button", { name: "Destination branch" }).textContent).toBe("trunk");
  expect(screen.getByRole("button", { name: "Integration method" }).textContent).toBe("Merge");
  expect(screen.getByRole("region", { name: "Changes to integrate" }).textContent).toContain(
    "latest",
  );
  expect(screen.getByRole("region", { name: "Changes to integrate" }).textContent).not.toContain(
    "outdated",
  );
  vi.mocked(integrateWorktree).mockResolvedValue(row());
  fireEvent.click(screen.getByRole("button", { name: "Integrate into trunk" }));
  await waitFor(() =>
    expect(integrateWorktree).toHaveBeenCalledWith(
      "one",
      expect.objectContaining({ token: "b".repeat(64), target: "trunk", strategy: "merge" }),
      "Improve search",
    ),
  );
});

it("integrates a dirty destination when its staged and unstaged changes can be preserved", async () => {
  const dirty = { ...review, target_dirty: true, target_conflicts: [], target_path: "/repo" };
  vi.mocked(integrateWorktree).mockResolvedValue(row());
  await prepare(dirty);
  expect(screen.getByText("Local changes in trunk will be kept.")).toBeTruthy();
  const integrate = screen.getByRole("button", { name: "Integrate into trunk" });
  expect((integrate as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(integrate);
  await waitFor(() =>
    expect(integrateWorktree).toHaveBeenCalledWith("one", dirty, "Improve search"),
  );
});

it.each([undefined, null, "unsupported"])(
  "requires a daemon restart for a dirty destination without preservation support (%s)",
  async (targetConflicts) => {
    await prepare({
      ...review,
      target_dirty: true,
      target_conflicts: targetConflicts as string[] | undefined,
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Restart the daemon to integrate into a checkout with local changes.",
    );
    expect(screen.queryByText("Local changes in trunk will be kept.")).toBeNull();
    const integrate = screen.getByRole("button", { name: "Integrate into trunk" });
    expect((integrate as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(integrate);
    expect(integrateWorktree).not.toHaveBeenCalled();
  },
);

it("shows destination collisions at their checkout and enables integration after a manual refresh clears them", async () => {
  await prepare({
    ...review,
    target_dirty: true,
    target_conflicts: ["local.txt"],
    target_path: "/checkout",
  });
  expect(screen.getByRole("alert").textContent).toContain("Conflicts in destination /checkout:");
  expect(screen.getByRole("alert").textContent).toContain("local.txt");
  expect(screen.getByRole("alert").textContent).toContain(
    "Resolve or commit these changes, then refresh, or choose another branch.",
  );
  expect(screen.queryByRole("button", { name: "Resolve in worktree" })).toBeNull();
  const integrate = screen.getByRole("button", { name: "Integrate into trunk" });
  expect((integrate as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(integrate);
  expect(integrateWorktree).not.toHaveBeenCalled();
  vi.mocked(previewIntegration).mockResolvedValue({
    ...review,
    target_conflicts: [],
    target_path: "/checkout",
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Integrate into trunk" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["worktree_target_unsupported", "worktree_git_busy"])(
  "keeps branch selection available when the initial destination has %s",
  async (targetError) => {
    await prepare({
      ...review,
      target_dirty: true,
      target_conflicts: [],
      target_error: targetError,
      target_path: "/unsupported-checkout",
    });
    expect(screen.getByRole("alert").textContent).toContain("/unsupported-checkout");
    expect(
      (screen.getByRole("button", { name: "Integrate into trunk" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Destination branch" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("Local changes in trunk will be kept.")).toBeNull();
    vi.mocked(previewIntegration).mockResolvedValue({
      ...review,
      target: "release",
      target_conflicts: [],
      target_error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Destination branch" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "release" }));
    await waitFor(() =>
      expect(previewIntegration).toHaveBeenLastCalledWith("one", "release", "squash"),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Integrate into release" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

it("returns to the diff after new work prevents cleanup instead of requiring the dialog to be reopened", async () => {
  vi.mocked(integrateWorktree).mockResolvedValue(row());
  vi.mocked(finishWorktree).mockRejectedValue(
    new DaemonError({ code: "worktree_has_changes", message: "Changed" }),
  );
  await prepare();
  fireEvent.click(screen.getByRole("button", { name: "Integrate into trunk" }));
  await screen.findByText("Commit 12345678 added to trunk.");
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree and branch" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The worktree changed after integration. Refresh its changes before deleting it.",
  );
  vi.mocked(previewIntegration).mockResolvedValue({
    ...review,
    files: ["next.txt"],
    diff: review.diff?.replaceAll("file.txt", "next.txt"),
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));
  await screen.findByRole("button", { name: "Integrate into trunk" });
  expect(screen.getByRole("region", { name: "Changes to integrate" }).textContent).toContain(
    "next.txt",
  );
  expect(screen.queryByText("Commit 12345678 added to trunk.")).toBeNull();
  expect(sessionsStore.getState().sessions.one?.worktree?.state).toBe("ready");
});

it("prepares conflicts in the worktree without integrating the target", async () => {
  vi.mocked(resolveWorktree).mockResolvedValue(undefined);
  const conflict = { ...review, conflicts: ["file.txt"] };
  await prepare(conflict);
  expect(screen.queryByRole("button", { name: "Integrate into trunk" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Resolve in worktree" }));
  await waitFor(() => expect(resolveWorktree).toHaveBeenCalledWith("one", conflict));
  expect(integrateWorktree).not.toHaveBeenCalled();
  await screen.findByText(/Resolve conflicts in/);
});

it("keeps cleaned conversations readable and removes command and prompt entry points", () => {
  const closed = { ...session, worktree: { ...session.worktree!, state: "closed" } };
  sessionsStore.setState({ sessions: { one: closed } });
  render(<SessionComposer sessionId="one" />);
  expect(screen.queryByLabelText("Composer")).toBeNull();
  expect(screen.queryByText("Commands")).toBeNull();
  expect(screen.getByText("Integrated")).toBeTruthy();
  expect(isSessionResumable(closed).resumable).toBe(false);
});

it.each(["idle", "active"] as const)(
  "opens the dialog but blocks review while a writer owns the session (%s)",
  async (activity) => {
    vi.mocked(getSessionAvailability).mockResolvedValue({
      ...free,
      owner: "mandri",
      can_resume: false,
    });
    render(<StoreBackedIntegration session={{ ...session, state: "live", activity }} />);
    fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
    await screen.findByText(
      "Mandri still controls this session. Stop or release its process before integrating.",
    );
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
  expect(
    screen.queryByText(
      "Mandri still controls this session. Stop or release its process before integrating.",
    ),
  ).toBeNull();
  await screen.findByLabelText("Destination branch");
  fireEvent.click(screen.getByRole("button", { name: "Integrate into trunk" }));
  await screen.findByText("Commit 12345678 added to trunk.");
  expect(integrateWorktree).toHaveBeenCalledWith("one", review, "Improve search");
  expect(stopSessionAction).not.toHaveBeenCalled();
});

it.each(["mandri", "external"] as const)(
  "blocks review when %s owns a session with a stale stopped record",
  async (owner) => {
    vi.mocked(getSessionAvailability).mockResolvedValue({ ...free, owner, can_resume: false });
    render(
      <StoreBackedIntegration
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
    await screen.findByText(
      owner === "mandri"
        ? "Mandri still controls this session. Stop or release its process before integrating."
        : "Another application owns this session. Release it there, then check availability again.",
    );
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
      <StoreBackedIntegration session={session} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await waitFor(() =>
    expect(previewIntegration).toHaveBeenCalledExactlyOnceWith("one", undefined, "squash"),
  );
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
  render(<StoreBackedIntegration session={session} />);
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
  const { rerender } = render(<StoreBackedIntegration session={current} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  expect(previewIntegration).not.toHaveBeenCalled();
  rerender(
    <StoreBackedIntegration
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
  const { rerender } = render(<StoreBackedIntegration session={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate…" }));
  await screen.findByLabelText("Destination branch");
  rerender(<StoreBackedIntegration session={{ ...session, state: "live", activity: "idle" }} />);
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

it("edits the commit message without rerendering the unchanged diff or refreshing the review", async () => {
  const translate = vi.spyOn(i18n, "t");
  try {
    vi.mocked(integrateWorktree).mockResolvedValue(row());
    await prepare();
    const integrate = screen.getByRole("button", { name: "Integrate into trunk" });
    await waitFor(() => expect((integrate as HTMLButtonElement).disabled).toBe(false));
    const diffTranslations = () =>
      translate.mock.calls.filter(([key]) => key === "worktree.hunk_lines").length;
    const initialDiffTranslations = diffTranslations();
    const initialOwnershipRequests = vi.mocked(getSessionAvailability).mock.calls.length;
    expect(initialDiffTranslations).toBeGreaterThan(0);
    const input = screen.getByLabelText("Commit message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect((integrate as HTMLButtonElement).disabled).toBe(true);
    const message = "Reviewed change";
    for (let length = 1; length <= message.length; length += 1) {
      fireEvent.change(input, { target: { value: message.slice(0, length) } });
      expect(input.value).toBe(message.slice(0, length));
    }
    expect(diffTranslations()).toBe(initialDiffTranslations);
    expect(previewIntegration).toHaveBeenCalledTimes(1);
    expect(getSessionAvailability).toHaveBeenCalledTimes(initialOwnershipRequests);
    expect((integrate as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("region", { name: "file.txt" }).textContent).toContain("changed");
    fireEvent.click(integrate);
    await screen.findByText("Commit 12345678 added to trunk.");
    expect(integrateWorktree).toHaveBeenCalledWith("one", review, message);
  } finally {
    translate.mockRestore();
  }
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
