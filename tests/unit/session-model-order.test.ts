import { beforeEach, expect, it, vi } from "vitest";
import { setSessionEffort, setSessionModel } from "@/daemon/rest/sessions";
import { swapSessionEffort } from "@/features/providers/swapSessionEffort";
import { swapSessionModel } from "@/features/providers/swapSessionModel";
import { sessionsStore } from "@/stores/sessions";

vi.mock("@/daemon/rest/sessions", () => ({ setSessionModel: vi.fn(), setSessionEffort: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  sessionsStore.setState({
    sessions: {
      s: {
        id: "s",
        title: "Session",
        state: "live",
        harness: "codex",
        deleted: false,
        pendingApprovals: 0,
        model: "provider/old",
        reasoningEffort: "low",
      },
    },
  });
});

it("finishes a failed effort rollback before applying the next model and effort", async () => {
  let rejectOld!: (error: Error) => void;
  vi.mocked(setSessionEffort).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  vi.mocked(setSessionModel).mockResolvedValue({
    model: "provider/new",
    reasoning_effort: null,
  } as Awaited<ReturnType<typeof setSessionModel>>);
  vi.mocked(setSessionEffort).mockResolvedValue({} as Awaited<ReturnType<typeof setSessionEffort>>);
  const first = swapSessionEffort("s", "high").catch(() => undefined);
  const model = swapSessionModel("s", "provider/new");
  const effort = swapSessionEffort("s", "ultra");
  await vi.waitFor(() => expect(setSessionEffort).toHaveBeenCalledTimes(1));
  expect(setSessionModel).not.toHaveBeenCalled();
  rejectOld(new Error("rejected"));
  await Promise.all([first, model, effort]);
  expect(setSessionModel).toHaveBeenCalledTimes(1);
  expect(setSessionEffort).toHaveBeenCalledTimes(2);
  expect(sessionsStore.getState().sessions.s).toMatchObject({
    model: "provider/new",
    reasoningEffort: "ultra",
  });
});
