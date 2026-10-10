import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer } from "@/features/transcript/Composer";
import { sessionsStore } from "@/stores/sessions";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { DaemonError } from "@/daemon/errors";
import { initI18n } from "@/i18n";
import type { SessionModeResult } from "@/daemon/types/ws";

beforeAll(() => initI18n("en"));
beforeEach(() => {
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness: "claude",
        state: "live",
        title: "Session",
        deleted: false,
        pendingApprovals: 0,
        nativeTurnActive: true,
        interactionMode: "default",
      },
    },
    drafts: {},
    order: ["s1"],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("sends live Claude permissions and changes the label only after acknowledgement", async () => {
  let acknowledge!: (result: SessionModeResult) => void;
  const send = vi.spyOn(sessionFeed, "setMode").mockReturnValue(
    new Promise((resolve) => {
      acknowledge = resolve;
    }),
  );
  render(<Composer sessionId="s1" />);
  fireEvent.click(document.querySelector(".composer-permissions")!);
  fireEvent.click(screen.getByRole("button", { name: /Accept edits/ }));
  expect(send).toHaveBeenCalledWith("s1", "acceptEdits");
  expect(sessionsStore.getState().sessions.s1?.interactionMode).toBe("default");
  expect((document.querySelector(".composer-permissions") as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () =>
    acknowledge({ session_id: "s1", mode: "acceptEdits", outcome: "mid_session_applied" }),
  );
  expect(sessionsStore.getState().sessions.s1?.interactionMode).toBe("acceptEdits");
});

it("keeps the acknowledged mode when the harness rejects the change", async () => {
  vi.spyOn(sessionFeed, "setMode").mockRejectedValue(
    new DaemonError({ code: "mode_rejected", message: "rejected" }),
  );
  render(<Composer sessionId="s1" />);
  fireEvent.click(document.querySelector(".composer-permissions")!);
  fireEvent.click(screen.getByRole("button", { name: /Accept edits/ }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(sessionsStore.getState().sessions.s1?.interactionMode).toBe("default");
  expect(sessionsStore.getState().sessions.s1?.resumeMode).toBeUndefined();
});

it("identifies Codex changes that apply on the next turn", async () => {
  sessionsStore.getState().applySessionPatch("s1", { harness: "codex", interactionMode: "ask" });
  vi.spyOn(sessionFeed, "setMode").mockResolvedValue({
    session_id: "s1",
    mode: "auto",
    outcome: "next_turn_applied",
  });
  render(<Composer sessionId="s1" />);
  fireEvent.click(document.querySelector(".composer-permissions")!);
  fireEvent.click(screen.getByRole("button", { name: /automatic review/ }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("next turn"));
});

it.each(["claude", "codex", "agy", "pi"] as const)(
  "silently acknowledges a restart for %s",
  async (harness) => {
    sessionsStore.getState().applySessionPatch("s1", { harness });
    vi.spyOn(sessionFeed, "setMode").mockResolvedValue({
      session_id: "s1",
      mode: "acceptEdits",
      outcome: "restarted",
    });
    render(<Composer sessionId="s1" />);
    fireEvent.click(document.querySelector(".composer-permissions")!);
    fireEvent.click(document.querySelector(".permission-option:not(:disabled)")!);
    await waitFor(() =>
      expect(sessionsStore.getState().sessions.s1?.interactionMode).toBe("acceptEdits"),
    );
    expect(screen.queryByRole("status")).toBeNull();
  },
);
