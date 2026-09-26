import { expect, it } from "vitest";
import type { HarnessKind } from "@/daemon/types/ws";
import type { SessionView } from "@/stores/sessions";
import { canShowFileSummary } from "@/features/transcript/fileChanges";
import { groupActivities } from "@/features/transcript/activityGroups";
import type { TranscriptNode } from "@/features/transcript/parse/types";

const harnesses: HarnessKind[] = ["codex", "claude", "opencode", "agy"];
const diff: TranscriptNode = { kind: "diff", path: "config.json", additions: 1, deletions: 0, key: "edit" };
const base: SessionView = { id: "session", title: "Session", harness: "codex", state: "discovered", deleted: false, pendingApprovals: 0 };

it.each(harnesses)("waits for external %s execution to finish, even when the last known turn has ended", (harness) => {
  const session: SessionView = { ...base, harness, nativeTurnActive: false,
    turnWork: [{ id: "previous", startedAt: 1, endedAt: 2 }],
    availability: { owner: "external", activity: "busy", can_resume: false, can_release: false, can_restore: false, reason: null },
  };
  for (const nodes of [[diff], [{ kind: "file_snapshot", scope: "session", files: [diff] } as TranscriptNode]]) {
    expect(canShowFileSummary(session)).toBe(false);
    expect(groupActivities(nodes, false, nodes.length, new Set(), canShowFileSummary(session)).some((row) => row.kind === "files")).toBe(false);
    const idle = { ...session, availability: { ...session.availability!, activity: "idle" as const } };
    expect(canShowFileSummary(idle)).toBe(true);
    expect(groupActivities(nodes, false, nodes.length, new Set(), canShowFileSummary(idle)).at(-1)?.kind).toBe("files");
  }
});

it.each(harnesses)("hides %s file summaries throughout managed execution and resumption", (harness) => {
  const idle: SessionView = { ...base, harness, state: "live", nativeTurnActive: false };
  const pending: Partial<SessionView>[] = [
    { sending: true }, { awaitingResponse: true }, { nativeTurnActive: true },
    { stopping: true }, { resumeStartedAt: 123 }, { externalBusy: true },
    { executionPhase: "preparing_image" }, { executionPhase: "starting" },
  ];
  for (const patch of pending) expect(canShowFileSummary({ ...idle, ...patch })).toBe(false);
  expect(canShowFileSummary(idle)).toBe(true);
});

it("does not treat unknown external activity as a completed execution", () => {
  expect(canShowFileSummary(undefined)).toBe(false);
  expect(canShowFileSummary(base)).toBe(false);
  expect(canShowFileSummary({ ...base, externalBusy: false })).toBe(true);
  expect(canShowFileSummary({ ...base, availability: { owner: "external", activity: "unknown", can_resume: false, can_release: false, can_restore: false, reason: null } })).toBe(false);
});

it("honors busy availability even before managed lifecycle events arrive", () => {
  expect(canShowFileSummary({ ...base, state: "live", nativeTurnActive: false,
    availability: { owner: "mandri", activity: "busy", can_resume: false, can_release: false, can_restore: false, reason: null },
  })).toBe(false);
});
