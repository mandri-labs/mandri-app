import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer } from "@/features/transcript/Composer";
import { SessionDot } from "@/features/sessions/SessionRow";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { initI18n } from "@/i18n";
import { DaemonError } from "@/daemon/errors";
import type { PromptOutcome } from "@/daemon/ws/sessionFeed";

const unowned = {
  owner: "unowned",
  activity: "idle",
  can_resume: true,
  can_release: false,
  can_restore: false,
  reason: null,
} as const;

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  transcriptStore.getState().resetTranscripts();
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness: "claude",
        state: "live",
        title: "Session",
        deleted: false,
        pendingApprovals: 0,
        promptError: "error.service_unavailable",
        nativeTurnActive: false,
      },
    },
    drafts: { s1: "Unsent first prompt" },
    order: ["s1"],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("retains the composer through unknown availability and disables delivery until verified", () => {
  sessionsStore.getState().applySessionPatch("s1", { state: "stopped", externalBusy: undefined });
  render(<Composer sessionId="s1" />);
  const input = screen.getByRole("textbox");
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector(".composer-external")).toBeNull();
  act(() =>
    sessionsStore.getState().applySessionPatch("s1", { externalBusy: true, availability: unowned }),
  );
  expect(screen.getByRole("textbox")).toBe(input);
  act(() =>
    sessionsStore
      .getState()
      .applySessionPatch("s1", {
        externalBusy: undefined,
        availability: { ...unowned, owner: "unknown", can_resume: false },
      }),
  );
  expect(screen.getByRole("textbox")).toBe(input);
  expect(document.querySelector(".composer-availability-hint")).toBeNull();
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  act(() =>
    sessionsStore
      .getState()
      .applySessionPatch("s1", {
        state: "live",
        externalBusy: true,
        availability: { ...unowned, owner: "mandri" },
      }),
  );
  expect(screen.getByRole("textbox")).toBe(input);
  act(() =>
    sessionsStore
      .getState()
      .applySessionPatch("s1", { state: "stopped", externalBusy: false, availability: unowned }),
  );
  expect(screen.getByRole("textbox")).toBe(input);
  act(() =>
    sessionsStore
      .getState()
      .applySessionPatch("s1", {
        externalBusy: false,
        availability: { ...unowned, owner: "external", can_resume: false },
      }),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("never shows an availability warning in the provisional composer before a session exists", () => {
  render(<Composer disabled harnessLabel="Codex" modelLabel="fixture/model" />);
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText(/Session activity could not be checked/)).toBeNull();
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(["unknown-first", "live-first"])("keeps startup stable when availability arrives %s", (order) => {
  sessionsStore.getState().applySessionPatch("s1", { state: "discovered", promptError: null });
  const feed = { sendPrompt: vi.fn(), interrupt: vi.fn() };
  render(<Composer sessionId="s1" feed={feed} />);
  const input = screen.getByRole("textbox");
  const states = [
    { availability: { ...unowned, owner: "unknown" as const, can_resume: false } },
    { state: "live" as const },
  ];
  if (order === "live-first") states.reverse();
  for (const patch of states) {
    act(() => sessionsStore.getState().applySessionPatch("s1", patch));
    expect(screen.getByRole("textbox")).toBe(input);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  }
  expect(feed.sendPrompt).not.toHaveBeenCalled();
});

it("shows the failed first prompt and prevents concurrent deliveries", async () => {
  let finish!: (result: PromptOutcome) => void;
  const sendPrompt = vi.fn(
    () =>
      new Promise<PromptOutcome>((resolve) => {
        finish = resolve;
      }),
  );
  const feed = { sendPrompt, interrupt: vi.fn(async () => true) };
  render(<Composer sessionId="s1" feed={feed} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(input.value).toBe("Unsent first prompt");
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("");
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers?.[0]?.node.text).toBe(
    "Unsent first prompt",
  );
  expect(sessionsStore.getState().sessions.s1?.awaitingResponse).toBe(true);
  expect(sendPrompt).toHaveBeenCalledTimes(1);
  expect(sessionsStore.getState().sessions.s1?.nativeTurnActive).toBeUndefined();
  finish({ state: "queued", code: null });
  await waitFor(() => expect(input.value).toBe(""));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.querySelector(".composer-badge")).toBeNull();
  expect(sessionsStore.getState().sessions.s1?.awaitingResponse).toBe(true);
});

it("retains the draft after a transient delivery failure", async () => {
  const feed = {
    sendPrompt: vi.fn(async (): Promise<PromptOutcome> => {
      throw new DaemonError({ code: "service_unavailable", message: "offline" });
    }),
    interrupt: vi.fn(async () => true),
  };
  render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await waitFor(() => expect(sessionsStore.getState().sessions.s1?.sending).toBe(false));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Unsent first prompt");
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(0);
  expect(sessionsStore.getState().sessions.s1?.awaitingResponse).toBe(false);
});

it("keeps an uncertain delivery for history reconciliation without restoring a duplicate draft", async () => {
  const feed = {
    sendPrompt: vi.fn(async (): Promise<PromptOutcome> => {
      throw new DaemonError({ code: "delivery_unknown", message: "lost acknowledgement" });
    }),
    interrupt: vi.fn(async () => true),
  };
  render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await waitFor(() => expect(sessionsStore.getState().sessions.s1?.sending).toBe(false));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(1);
  expect(sessionsStore.getState().sessions.s1?.awaitingResponse).toBe(false);
  expect(sessionsStore.getState().sessions.s1?.promptError).toBe("error.delivery_unknown");
  expect(feed.sendPrompt).toHaveBeenCalledTimes(1);
});

it("preserves both the failed message and text composed during delivery", async () => {
  let rejectPrompt!: (error: Error) => void;
  const feed = {
    sendPrompt: vi.fn(
      () =>
        new Promise<PromptOutcome>((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    ),
    interrupt: vi.fn(async () => true),
  };
  render(<Composer sessionId="s1" feed={feed} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "Next draft" } });
  rejectPrompt(new Error("offline"));
  await screen.findByRole("alert");
  expect(input.value).toBe("Unsent first prompt\n\nNext draft");
});

it("keeps keystrokes out of session metadata and shares drafts across mounted composers", () => {
  render(
    <>
      <Composer sessionId="s1" />
      <Composer sessionId="s1" />
    </>,
  );
  const metadata = sessionsStore.getState().sessions;
  const order = sessionsStore.getState().order;
  const inputs = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
  fireEvent.change(inputs[0]!, { target: { value: "A fast draft" } });
  expect(inputs[1]!.value).toBe("A fast draft");
  expect(sessionsStore.getState().sessions).toBe(metadata);
  expect(sessionsStore.getState().order).toBe(order);
  act(() => sessionsStore.getState().applySessionPatch("s1", { activity: "active" }));
  expect(inputs[0]!.value).toBe("A fast draft");
});

it("retains each draft through route changes and unmounts", () => {
  sessionsStore.setState({
    sessions: {
      ...sessionsStore.getState().sessions,
      other: { ...sessionsStore.getState().sessions.s1!, id: "other" },
    },
  });
  const view = render(<Composer sessionId="s1" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this draft" } });
  view.rerender(<Composer sessionId="other" />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  view.rerender(<Composer sessionId="s1" />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep this draft");
  view.unmount();
  render(<Composer sessionId="s1" />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep this draft");
});

it("does not invalidate sessions for repeated status patches", () => {
  const metadata = sessionsStore.getState().sessions;
  sessionsStore.getState().applySessionPatch("s1", { state: "live", pendingApprovals: 0 });
  expect(sessionsStore.getState().sessions).toBe(metadata);
});

it("resumes with the selected permissions before sending the prompt", async () => {
  sessionsStore.getState().applySessionPatch("s1", {
    state: "stopped",
    externalBusy: false,
    availability: unowned,
    nativeId: "native-1",
    daemonOrigin: true,
    interactionMode: "default",
    model: "provider/model",
  });
  const calls: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push("resume");
    expect(JSON.parse(String(init?.body))).toEqual({ mode: "acceptEdits" });
    return new Response(
      JSON.stringify({
        id: "s1",
        harness: "claude",
        state: "live",
        gateway_route_id: "route-1",
        mode: "acceptEdits",
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const feed = {
    sendPrompt: vi.fn(async (): Promise<PromptOutcome> => {
      calls.push("prompt");
      return { state: "queued", code: null };
    }),
    interrupt: vi.fn(async () => true),
  };
  try {
    render(<Composer sessionId="s1" feed={feed} />);
    const trigger = screen.getByRole("button", { name: "Permission mode" });
    expect(trigger.textContent).toContain("Manual");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /^Accept edits / }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(calls).toEqual(["resume", "prompt"]));
    expect(sessionsStore.getState().sessions.s1?.harness).toBe("claude");
    expect(sessionsStore.getState().sessions.s1?.interactionMode).toBe("acceptEdits");
    expect(sessionsStore.getState().sessions.s1?.resumeMode).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("replaces send with immediate STOP for an empty running composer", async () => {
  sessionsStore.getState().setDraft("s1", "   ");
  sessionsStore.getState().applySessionPatch("s1", { nativeTurnActive: true });
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const feed = { sendPrompt: vi.fn(), interrupt: vi.fn() };
  render(<Composer sessionId="s1" feed={feed} />);
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/v1/sessions/s1/stop"),
    expect.objectContaining({ method: "POST" }),
  );
  await waitFor(() => expect(sessionsStore.getState().sessions.s1?.state).toBe("stopped"));
  expect(feed.interrupt).not.toHaveBeenCalled();
  expect(feed.sendPrompt).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
});

it("keeps sending steering when a running composer contains text", async () => {
  sessionsStore.getState().applySessionPatch("s1", { nativeTurnActive: true, promptError: null });
  const feed = {
    sendPrompt: vi.fn(async (): Promise<PromptOutcome> => ({ state: "steered", code: null })),
    interrupt: vi.fn(),
  };
  render(<Composer sessionId="s1" feed={feed} />);
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(feed.sendPrompt).toHaveBeenCalledWith("s1", "Unsent first prompt"));
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
});

it("allows STOP during pending approval even when prompt delivery is disabled", async () => {
  sessionsStore.getState().setDraft("s1", "");
  sessionsStore.getState().applySessionPatch("s1", { pendingApprovals: 1, needsAttention: true });
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Composer sessionId="s1" disabled />);
  const stop = screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement;
  expect(stop.disabled).toBe(false);
  fireEvent.click(stop);
  await waitFor(() => expect(sessionsStore.getState().sessions.s1?.state).toBe("stopped"));
});

it("does not stop on empty Enter or resume from a late prompt error after STOP", async () => {
  let rejectPrompt!: (error: Error) => void;
  const feed = {
    sendPrompt: vi.fn(() => new Promise<PromptOutcome>((_resolve, reject) => { rejectPrompt = reject; })),
    interrupt: vi.fn(),
  };
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(sessionsStore.getState().sessions.s1?.state).toBe("stopped"));
  await act(async () => {
    rejectPrompt(new DaemonError({ code: "session_not_running", message: "stopped" }));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(feed.sendPrompt).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(0);
});

it("shows stop failures and allows retry without leaving the composer disabled", async () => {
  sessionsStore.getState().setDraft("s1", "");
  sessionsStore.getState().applySessionPatch("s1", { nativeTurnActive: true, promptError: null });
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("offline");
  }));
  render(<Composer sessionId="s1" />);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await screen.findByRole("alert");
  expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(false);
  expect(sessionsStore.getState().sessions.s1?.state).toBe("live");
});

it("keeps the draft and permits retry after Codex resume readiness times out", async () => {
  sessionsStore.getState().applySessionPatch("s1", {
    harness: "codex", state: "stopped", nativeId: "native-1", daemonOrigin: true,
    availability: unowned, model: "native:codex/gpt-6-luna", promptError: null,
  });
  const resume = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
      code: "native_initialization_timeout", message: "The harness did not become ready in time", detail: {},
    } }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "s1", harness: "codex", state: "live" }), { status: 200 }));
  vi.stubGlobal("fetch", (url: unknown) => String(url).endsWith("/resume") ? resume() : Promise.resolve(new Response("[]", { status: 200 })));
  const feed = { sendPrompt: vi.fn(async (): Promise<PromptOutcome> => ({state: "queued", code: null})), interrupt: vi.fn() };
  render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await waitFor(() => expect(sessionsStore.getState().sessions.s1?.sending).toBe(false));
  expect(sessionsStore.getState().sessions.s1?.resumeStartedAt).toBeUndefined();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Unsent first prompt");
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(0);
  expect(feed.sendPrompt).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await waitFor(() => expect(feed.sendPrompt).toHaveBeenCalledTimes(1));
  expect(resume).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sessionsStore.getState().sessions.s1?.state).toBe("live");
});

it("clears STOP after native completion despite an active metadata snapshot", () => {
  sessionsStore.getState().setDraft("s1", "");
  sessionsStore.getState().applySessionPatch("s1", {
    harness: "opencode", activity: "active", nativeTurnActive: true, promptError: null,
    sending: false, awaitingResponse: false,
  });
  render(<Composer sessionId="s1" />);
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  act(() => sessionsStore.getState().ingestFrame({
    topic: "session.s1", seq: 1, ts: 1, source: "opencode",
    raw: { type: "session.status", properties: { sessionID: "native", status: { type: "idle" } } },
  }));
  expect(sessionsStore.getState().sessions.s1?.activity).toBe("active");
  expect(sessionsStore.getState().sessions.s1?.nativeTurnActive).toBe(false);
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
});

it.each([
  { sending: true }, { awaitingResponse: true }, { pendingApprovals: 1 },
  { stopping: true }, { nativeTurnActive: undefined }, { externalBusy: true },
])("keeps STOP and the session indicator for pending work %j", (pending) => {
  sessionsStore.getState().setDraft("s1", "");
  sessionsStore.getState().applySessionPatch("s1", {
    activity: "active", nativeTurnActive: false, promptError: null, ...pending,
  });
  render(<><Composer sessionId="s1" /><SessionDot session={sessionsStore.getState().sessions.s1!} /></>);
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  expect(document.querySelector(".session-dot--live")).toBeTruthy();
});

it("shows an idle session dot for the completed real-session snapshot", () => {
  sessionsStore.getState().applySessionPatch("s1", {
    harness: "opencode", activity: "active", nativeTurnActive: false, promptError: null,
    sending: false, awaitingResponse: false, externalBusy: false,
  });
  render(<SessionDot session={sessionsStore.getState().sessions.s1!} />);
  expect(document.querySelector(".session-dot--idle")).toBeTruthy();
});
