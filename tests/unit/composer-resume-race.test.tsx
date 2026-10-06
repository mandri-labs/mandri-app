import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readPendingUsers } from "@/features/transcript/pendingUserStorage";
import { Composer } from "@/features/transcript/Composer";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { refreshSessionMetadata } from "@/app/sessionSync";
import { listSessions } from "@/daemon/rest/sessions";
vi.mock("@/daemon/rest/sessions", () => ({ listSessions: vi.fn() }));
vi.mock("@/app/connection", () => ({
  getDaemonSocket: () => ({ request: async () => ({ sessions: await listSessions() }) }),
}));
import { initI18n } from "@/i18n";
beforeAll(async () => {
  await initI18n("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(["none", "rest", "snapshot", "metadata", "stop"])(
  "resume delivery with %s synchronization",
  async (sync) => {
    localStorage.clear();
    transcriptStore.getState().resetTranscripts();
    sessionsStore.setState({
      sessions: {
        s1: {
          id: "s1",
          harness: "codex",
          state: "stopped",
          title: "Synthetic",
          deleted: false,
          pendingApprovals: 0,
          nativeId: "native-1",
          daemonOrigin: true,
          model: "native:codex/gpt-6-luna",
          externalBusy: false,
          promptError: null,
          availability: {
            owner: "unowned",
            activity: "idle",
            can_resume: true,
            can_release: false,
            can_restore: false,
            reason: null,
          },
        },
      },
      drafts: { s1: "SYNTHETIC_RESUME_MESSAGE" },
      order: ["s1"],
    });
    let resolveResume!: (response: Response) => void;
    const resumed = new Promise<Response>((resolve) => {
      resolveResume = resolve;
    });
    const resume = vi.fn(() => resumed);
    vi.stubGlobal("fetch", (url: unknown) =>
      String(url).endsWith("/resume")
        ? resume()
        : Promise.resolve(new Response("[]", { status: 200 })),
    );
    const feed = {
      sendPrompt: vi.fn(async () => ({ state: "queued" as const, code: null })),
      interrupt: vi.fn(),
    };
    render(<Composer sessionId="s1" feed={feed} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    const storedBeforeResume = readPendingUsers("s1").map((entry) => entry.node.text);
    const revisionBefore = sessionsStore.getState().sessions.s1!.stopRevision ?? 0;
    act(() => {
      if (sync === "stop")
        sessionsStore.getState().ingestFrame({
          topic: "sessions.all",
          seq: 1,
          ts: 1,
          source: "mandri",
          raw: { type: "session_stopped", session_id: "s1", cause: "user" },
        });
      if (sync === "rest")
        sessionsStore.getState().upsertFromRest([
          {
            id: "s1",
            harness: "codex",
            state: "stopped",
            title: "Synthetic",
            project_path: "/synthetic",
            native_id: "native-1",
            model: null,
            created_at: 1,
            updated_at: 1,
          },
        ]);
      if (sync === "snapshot")
        sessionsStore.getState().ingestFrame({
          type: "snapshot",
          topic: "sessions.all",
          sessions: [
            {
              id: "s1",
              harness: "codex",
              state: "stopped",
              title: "Synthetic",
            },
          ],
          runtimes: [],
        });
    });
    if (sync === "metadata") {
      vi.mocked(listSessions).mockResolvedValue([
        {
          id: "s1",
          harness: "codex",
          state: "stopped",
          title: "Synthetic",
          project_path: "/synthetic",
          native_id: "native-1",
          model: null,
          created_at: 1,
          updated_at: 1,
        },
      ]);
      await act(async () => refreshSessionMetadata());
    }
    await act(async () =>
      resolveResume(
        new Response(JSON.stringify({ id: "s1", harness: "codex", state: "live" }), {
          status: 200,
        }),
      ),
    );
    await waitFor(() =>
      expect(sessionsStore.getState().sessions.s1!.resumeStartedAt).toBeUndefined(),
    );
    const evidence = {
      storedBeforeResume,
      storedAfterResume: readPendingUsers("s1").map((entry) => entry.node.text),
      sync,
      revisionBefore,
      revisionAfter: sessionsStore.getState().sessions.s1!.stopRevision ?? 0,
      promptCalls: feed.sendPrompt.mock.calls.length,
      draft: sessionsStore.getState().drafts.s1 ?? "",
      pending: transcriptStore.getState().transcripts.s1?.pendingUsers?.length ?? 0,
      local: transcriptStore.getState().transcripts.s1?.localUsers?.length ?? 0,
      alert: screen.queryByRole("alert")?.textContent ?? null,
      state: sessionsStore.getState().sessions.s1!.state,
    };

    if (sync === "stop") {
      expect(evidence.promptCalls).toBe(0);
      expect(evidence.draft).toBe("SYNTHETIC_RESUME_MESSAGE");
      expect(evidence.revisionAfter).toBeGreaterThan(revisionBefore);
      expect(evidence.storedAfterResume).toEqual([]);
      return;
    }
    expect(evidence.promptCalls).toBe(1);
    expect(evidence.draft).toBe("");
    expect(evidence.alert).toBeNull();
    expect(evidence.pending).toBe(1);
    expect(evidence.local).toBe(1);
    expect(evidence.revisionAfter).toBe(revisionBefore);
    expect(evidence.storedAfterResume).toEqual(["SYNTHETIC_RESUME_MESSAGE"]);
  },
);
