import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { sessionsStore, transcriptStore, type SessionView } from "@/stores/sessions";
import { applyAvailability } from "@/features/sessions/availability";
import { Transcript } from "@/features/transcript/Transcript";
import type { HarnessKind } from "@/daemon/types/ws";

// Render all rows: DOM test environments do not measure a scroll viewport.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; getItemKey: (index: number) => string }) => ({
    getTotalSize: () => options.count * 40,
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({
      index, key: options.getItemKey(index), start: index * 40,
    })),
    measureElement: () => {},
    scrollToEnd: () => {},
    scrollRect: { height: 800 },
  }),
}));

beforeAll(() => initI18n("en"));
afterEach(() => {
  cleanup();
  transcriptStore.getState().resetTranscripts();
  sessionsStore.setState({ sessions: {} });
});

const harnesses: HarnessKind[] = ["codex", "claude", "opencode", "agy"];
const feed = { ensureSession: () => {}, loadHistory: async () => {} };

it.each(harnesses)("updates the %s file summary when external execution ends and resumes", async (harness) => {
  const availability = {
    owner: "external" as const, activity: "busy" as const,
    can_resume: false, can_release: false, can_restore: false, reason: null,
  };
  const session: SessionView = {
    id: "external", title: "External", harness, state: "discovered", deleted: false,
    pendingApprovals: 0, nativeTurnActive: false, availability,
    turnWork: [{ id: "previous", startedAt: 1, endedAt: 2 }],
  };
  sessionsStore.setState({ sessions: { external: session } });
  transcriptStore.getState().setNodes("external", [
    { kind: "diff", key: "edit", path: "config.json", additions: 1, deletions: 0 },
    { kind: "assistant", key: "message", text: "Progress update" },
  ]);
  transcriptStore.getState().setFlags("external", { historyExhausted: true });
  const view = render(<Transcript sessionId="external" harness={harness} feed={feed} />);
  await act(async () => {});
  const summary = () => view.container.querySelector(".tr-changed-files");
  expect(summary()).toBeNull();
  fireEvent.click(view.container.querySelector(".tr-activity-group > button")!);
  expect(view.container.querySelector(".tr-activity-group .tr-diff")).not.toBeNull();

  act(() => applyAvailability("external", { ...availability, activity: "idle" }));
  expect(summary()).not.toBeNull();
  act(() => applyAvailability("external", availability));
  expect(summary()).toBeNull();
  expect(view.container.querySelector(".tr-activity-group .tr-diff")).not.toBeNull();
});
