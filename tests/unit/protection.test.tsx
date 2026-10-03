import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { choicePolicy, permitsModel, policyFromWire } from "@/daemon/protection";
import { request } from "@/daemon/rest/client";
import { cancelStartup, listRuntimes, startSession, resumeSession } from "@/daemon/rest/runtime";
import {
  startNewSession,
  errorKey,
  restoreNativeModelAction,
  resumeSessionAction,
} from "@/features/sessions/lifecycle";
import { swapSessionModel } from "@/features/providers/swapSessionModel";
import { applyExecutionStatus } from "@/features/sessions/executionStatus";
import { WelcomeComposer } from "@/features/sessions/WelcomeComposer";
import { ModelMenu } from "@/features/transcript/ModelMenu";
import { SessionProtection } from "@/features/sessions/SessionProtection";
import { getSessionPrivacy } from "@/daemon/rest/sessions";
import { nativeModelsStore } from "@/features/providers/nativeModels";
import { connectionStore } from "@/stores/connection";
import { preferencesStore } from "@/stores/preferences";
import { providersStore } from "@/stores/providers";
import { sessionsStore, type SessionView } from "@/stores/sessions";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { initI18n } from "@/i18n";
import { DaemonError } from "@/daemon/errors";
import { isSessionWorking } from "@/features/transcript/turnActivity";

vi.mock("@/daemon/rest/client", async (original) => ({
  ...(await original<typeof import("@/daemon/rest/client")>()),
  request: vi.fn(),
}));
vi.mock("@/daemon/rest/sessions", async (original) => ({
  ...(await original<typeof import("@/daemon/rest/sessions")>()),
  getSessionPrivacy: vi.fn(async () => ({ revision: 1, entries: [] })),
}));
vi.mock("@/daemon/rest/runtime", () => ({
  startSession: vi.fn(),
  listRuntimes: vi.fn(),
  cancelStartup: vi.fn(),
  stopSession: vi.fn(),
  resumeSession: vi.fn(),
}));
vi.mock("@/daemon/rest/providers", () => ({
  listProviders: vi.fn(async () => []),
  listProviderModels: vi.fn(async () => []),
}));
vi.mock("@/daemon/ws/sessionFeed", () => ({
  sessionFeed: {
    ensureSession: vi.fn(),
    subscribeSession: vi.fn(),
    sendPrompt: vi.fn(async () => undefined),
  },
}));

function chooseProtection(name: RegExp): void {
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  fireEvent.click(screen.getByRole(name.test("Pseudonymized") ? "switch" : "button", { name }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
}

function session(extra: Partial<SessionView> = {}): SessionView {
  return {
    id: "protected",
    harness: "codex",
    state: "stopped",
    title: "Workspace",
    deleted: false,
    pendingApprovals: 0,
    executionBackend: "host",
    privacyMode: "surrogate",
    policyRevision: 3,
    policyConfirmed: true,
    ...extra,
  };
}

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  localStorage.clear();
  connectionStore.setState({ status: "online" });
  sessionsStore.setState({ sessions: {}, order: [], drafts: {} });
  preferencesStore.setState({ defaultHarness: undefined, defaultModel: undefined });
  providersStore.setState({ providers: {} });
  nativeModelsStore.setState({ catalogs: {} });

  vi.mocked(request).mockReset().mockResolvedValue([]);
  vi.mocked(listRuntimes).mockResolvedValue([
    { harness: "claude", installed: true, degraded: false },
    { harness: "codex", installed: false, degraded: false },
  ]);
  vi.mocked(startSession).mockReset();
  vi.mocked(resumeSession).mockReset();
  vi.mocked(cancelStartup).mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens the registry in a separate dialog without changing protection", async () => {
  render(<SessionProtection session={session({ state: "live" })} />);
  const trigger = screen.getByRole("button", { name: "Session protection" });
  fireEvent.click(trigger);
  expect(screen.queryByText("Protected data")).toBeNull();
  expect(getSessionPrivacy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View protected data" }));
  await screen.findByText("0 protected values");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByRole("dialog").querySelector(".settings-modal-nav")).toBeNull();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it.each([
  ["standard", "host", "none"],
  ["surrogate", "host", "surrogate"],
  ["docker", "docker", "none"],
  ["paranoid", "docker", "surrogate"],
] as const)("maps %s independently from harness permissions", (choice, execution, privacy) => {
  expect(choicePolicy(choice)).toEqual({ execution_backend: execution, privacy_mode: privacy });
});

it("retains the draft when the daemon cannot prepare a Docker image", async () => {
  preferencesStore.setState({ defaultModel: "fixture/model" });
  vi.mocked(startSession).mockRejectedValue(
    new DaemonError({ code: "docker_image_pull_failed", message: "Pull failed" }),
  );
  render(<WelcomeComposer initialCwd="/workspace" />);
  await screen.findByText("Claude Code");
  chooseProtection(/^Docker sandbox/);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Synthetic task" } });
  fireEvent.click(screen.getByLabelText("Send"));
  expect((await screen.findByRole("alert")).textContent).toContain("could not be downloaded");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Synthetic task");
  expect(sessionFeed.sendPrompt).not.toHaveBeenCalled();
});

it("propagates a missing worker image on resume and preserves the stopped session", async () => {
  sessionsStore.setState({
    sessions: { protected: session({ executionBackend: "docker" }) },
    order: ["protected"],
  });
  vi.mocked(resumeSession).mockRejectedValue(
    new DaemonError({ code: "docker_image_missing", message: "Missing image" }),
  );
  await expect(resumeSessionAction("protected")).rejects.toMatchObject({
    code: "docker_image_missing",
  });
  expect(resumeSession).toHaveBeenCalledTimes(1);
  expect(sessionsStore.getState().sessions.protected).toMatchObject({
    state: "stopped",
    privacyMode: "surrogate",
  });
  expect(sessionFeed.sendPrompt).not.toHaveBeenCalled();
});

it("offers protection choices for daemon validation with the selected harness", async () => {
  preferencesStore.setState({ defaultHarness: "opencode", defaultModel: "fixture/model" });
  vi.mocked(listRuntimes).mockResolvedValue([
    { harness: "opencode", installed: true, degraded: false },
  ]);
  render(<WelcomeComposer initialCwd="/workspace" />);
  await waitFor(() => expect(screen.getByLabelText("Harness").textContent).toContain("OpenCode"));
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  for (const name of [/^Standard/, /^Docker sandbox/, /^Worktree/]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
  }
  expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
});

it("propagates daemon adapter refusals without sending a prompt or creating a session", async () => {
  sessionsStore.setState({
    sessions: { protected: session({ harness: "opencode" }) },
    order: ["protected"],
  });
  const error = new DaemonError({ code: "plugin_llm_unsupported", message: "Unsupported adapter" });
  vi.mocked(startSession).mockRejectedValue(error);
  vi.mocked(resumeSession).mockRejectedValue(error);
  await expect(
    startNewSession({
      harness: "opencode",
      model: "fixture/model",
      cwd: "/workspace",
      execution_backend: "host",
      privacy_mode: "surrogate",
    }),
  ).rejects.toMatchObject({ code: "plugin_llm_unsupported" });
  await expect(resumeSessionAction("protected")).rejects.toMatchObject({
    code: "plugin_llm_unsupported",
  });
  expect(startSession).toHaveBeenCalledTimes(1);
  expect(resumeSession).toHaveBeenCalledTimes(1);
  expect(sessionsStore.getState().order).toEqual(["protected"]);
  expect(sessionsStore.getState().sessions.protected?.state).toBe("stopped");
  expect(sessionFeed.sendPrompt).not.toHaveBeenCalled();
});

it("removes native catalogs and the native exact-reference option", async () => {
  const select = vi.fn();
  render(<ModelMenu harness="codex" allowNative={false} onSelect={select} />);
  expect(screen.queryByText("Harness default")).toBeNull();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "native:codex/default" } });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(select).not.toHaveBeenCalled();
  expect(screen.queryByText(/Use exactly/)).toBeNull();
  expect(request).not.toHaveBeenCalledWith(
    expect.stringContaining("/runtimes/codex/models"),
    expect.anything(),
  );
});

it("preserves a native default and blocks submission when switching to surrogate", async () => {
  preferencesStore.setState({ defaultModel: "native:claude/default" });
  render(<WelcomeComposer initialCwd="/workspace" />);
  await waitFor(() => expect(screen.getByLabelText("Harness").textContent).toContain("Claude"));
  const before = screen.getByLabelText("Harness").textContent;
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Synthetic task" } });
  expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false);
  chooseProtection(/^Pseudonymized/);
  expect(screen.getByLabelText("Harness").textContent).toBe(before);
  expect(screen.getByLabelText("Model").textContent).toContain("default");
  expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
});

it("admits a Docker harness independently of host installation", async () => {
  preferencesStore.setState({ defaultHarness: "codex", defaultModel: "fixture/model" });
  render(<WelcomeComposer initialCwd="/workspace" />);
  await screen.findByText("Claude Code");
  chooseProtection(/^Docker sandbox/);
  fireEvent.click(screen.getByLabelText("Harness"));
  const codex = await screen.findByRole("button", { name: "Codex" });
  expect((codex as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(codex);
  expect(screen.getByLabelText("Harness").textContent).toContain("Codex");
});

it("rejects native creation, model swaps and native restoration before network calls", async () => {
  sessionsStore.setState({ sessions: { protected: session() }, order: ["protected"] });
  expect(permitsModel("native:claude/default", session())).toBe(false);
  await expect(
    startNewSession({
      harness: "codex",
      model: "native:codex/default",
      cwd: "/workspace",
      privacy_mode: "surrogate",
      execution_backend: "host",
    }),
  ).rejects.toMatchObject({ code: "privacy_native_unsupported" });
  await expect(swapSessionModel("protected", "native:codex/default")).rejects.toMatchObject({
    code: "privacy_native_unsupported",
  });
  await expect(restoreNativeModelAction("protected")).rejects.toMatchObject({
    code: "privacy_native_unsupported",
  });
  expect(request).not.toHaveBeenCalled();
  expect(startSession).not.toHaveBeenCalled();
});

it("sends protection and native permission fields independently, then seeds confirmed policy", async () => {
  vi.mocked(startSession).mockResolvedValue({
    id: "new",
    harness: "codex",
    gateway_route_id: null,
    state: "live",
    execution_backend: "docker",
    privacy_mode: "surrogate",
    policy_revision: 1,
  } as Awaited<ReturnType<typeof startSession>>);
  await startNewSession({
    harness: "codex",
    model: "fixture/model",
    cwd: "/workspace",
    mode: "ask",
    execution_backend: "docker",
    privacy_mode: "surrogate",
  });
  expect(startSession).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "ask",
      execution_backend: "docker",
      privacy_mode: "surrogate",
    }),
  );
  expect(sessionsStore.getState().sessions.new).toMatchObject({
    executionBackend: "docker",
    privacyMode: "surrogate",
    policyConfirmed: true,
  });
});

it("rejects a successful old-server reply that does not confirm protection", async () => {
  vi.mocked(startSession).mockResolvedValue({
    id: "new",
    harness: "codex",
    gateway_route_id: null,
    state: "live",
  });
  await expect(
    startNewSession({
      harness: "codex",
      model: "fixture/model",
      cwd: "/workspace",
      execution_backend: "host",
      privacy_mode: "surrogate",
    }),
  ).rejects.toMatchObject({ code: "session_policy_unconfirmed" });
  expect(sessionsStore.getState().sessions.new).toBeUndefined();
});

it("preserves confirmed policy across absent/stale metadata without overwriting newer titles", () => {
  const previous = session();
  const missing = policyFromWire({ title: "new title" }, previous);
  expect(missing.privacyMode).toBe("surrogate");
  expect(missing).not.toHaveProperty("title");
  const stale = policyFromWire(
    { execution_backend: "host", privacy_mode: "none", policy_revision: 2 },
    previous,
  );
  expect(stale.privacyMode).toBe("surrogate");
  const updated = policyFromWire(
    { execution_backend: "host", privacy_mode: "none", policy_revision: 4 }, previous,
  );
  expect(updated).toMatchObject({ privacyMode: "none", policyRevision: 4 });
  const conflict = policyFromWire(
    { execution_backend: "host", privacy_mode: "none", policy_revision: 3 },
    previous,
  );
  expect(conflict).toMatchObject({
    privacyMode: "surrogate",
    executionReason: "session_policy_conflict",
    effectiveBinding: false,
  });
});

it("does not regress execution phase from stale generations or revisions", () => {
  sessionsStore.setState({
    sessions: {
      protected: session({
        state: "live",
        executionGeneration: 2,
        executionRevision: 5,
        executionPhase: "ready",
        effectiveBinding: true,
      }),
    },
  });
  const incoming = {
    session_id: "protected",
    execution_backend: "host",
    privacy_mode: "surrogate",
    policy_revision: 3,
    generation: 2,
    revision: 4,
    phase: "starting",
    effective_binding: false,
  } as const;
  applyExecutionStatus("protected", incoming);
  expect(sessionsStore.getState().sessions.protected?.executionPhase).toBe("ready");
  applyExecutionStatus("protected", { ...incoming, generation: 1, revision: 99 });
  expect(sessionsStore.getState().sessions.protected?.effectiveBinding).toBe(true);
});

it("shows a daemon refusal to fork without changing the source session", async () => {
  const source = session();
  sessionsStore.setState({ sessions: { protected: source }, order: ["protected"] });
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/fork"))
      throw new DaemonError({ code: "session_transition_unsupported", message: "Unsupported" });
    return [];
  });
  render(<SessionProtection session={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not yet supported");
  expect(sessionsStore.getState().sessions.protected).toEqual(source);
  expect(sessionsStore.getState().order).toEqual(["protected"]);
});

it("forks execution context with the supported API contract and preserves permissions", async () => {
  const source = session({
    model: "fixture/model",
    interactionMode: "ask",
    executionBackend: "docker",
    privacyMode: "none",
  });
  sessionsStore.setState({ sessions: { protected: source }, order: ["protected"] });

  const fork = {
    id: "forked",
    harness: "codex",
    gateway_route_id: "route",
    state: "live",
    execution_backend: "host",
    privacy_mode: "none",
    policy_revision: 1,
  };
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/fork")) return fork;
    if (path.endsWith("/forked"))
      return {
        ...fork,
        title: "Fork",
        project_path: "/workspace",
        created_at: 1,
        updated_at: 1,
        model: "fixture/model",
        native_id: "native-fork",
      };
    return [];
  });
  render(<SessionProtection session={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  expect(screen.queryByRole("button", { name: "Create new session" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Standard/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
  await waitFor(() =>
    expect(sessionsStore.getState().sessions.forked?.privacyMode).toBe("none"),
  );
  expect(request).toHaveBeenCalledWith(
    "/v1/sessions/protected/fork",
    expect.objectContaining({
      method: "POST",
      body: {
        execution_backend: "host",
        privacy_mode: "none",
        mode: "ask",
        operation_id: expect.any(String),
      },
    }),
  );
  expect(sessionsStore.getState().sessions.protected).toMatchObject({
    state: "stopped",
    executionBackend: "docker",
    privacyMode: "none",
  });
});

it("cancels a pending fork on the daemon and ignores its late successful result", async () => {
  const source = session({ model: "fixture/model", executionBackend: "docker" });
  sessionsStore.setState({ sessions: { protected: source }, order: ["protected"] });

  let finish!: (value: unknown) => void;
  vi.mocked(request).mockImplementation((path) =>
    path.endsWith("/fork")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve([]),
  );
  vi.mocked(cancelStartup).mockResolvedValue(undefined);
  render(<SessionProtection session={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  fireEvent.click(screen.getByRole("button", { name: /^Standard/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(cancelStartup).toHaveBeenCalledTimes(1));
  const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith("/fork"));
  const body = call?.[1]?.body as { operation_id: string };
  expect(cancelStartup).toHaveBeenCalledWith(body.operation_id);
  await act(async () => {
    finish({ id: "forked", execution_backend: "docker", privacy_mode: "none", policy_revision: 1 });
  });
  expect(sessionsStore.getState().sessions.forked).toBeUndefined();
  expect(sessionsStore.getState().sessions.protected?.privacyMode).toBe("surrogate");
});

it("rejects an unconfirmed fork result and preserves the source session", async () => {
  const source = session({ model: "fixture/model" });
  sessionsStore.setState({ sessions: { protected: source }, order: ["protected"] });
  vi.mocked(request).mockImplementation(async (path) =>
    path.endsWith("/fork") ? { id: "forked" } : [],
  );
  render(<SessionProtection session={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
  expect((await screen.findByRole("alert")).textContent).toContain("did not confirm");
  expect(sessionsStore.getState().sessions.protected).toEqual(source);
  expect(sessionsStore.getState().sessions.forked).toBeUndefined();
});

it("shows startup activity without a cancel button and preserves the draft on failure", async () => {
  preferencesStore.setState({ defaultModel: "fixture/model" });
  let rejectStart!: (error: Error) => void;
  vi.mocked(startSession).mockImplementation(() => new Promise((_resolve, reject) => { rejectStart = reject; }));
  render(<WelcomeComposer initialCwd="/workspace" />);
  await screen.findByText("Claude Code");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByLabelText("Send"));
  expect(screen.getByRole("status").textContent).toBe("Thinking");
  expect(screen.queryByRole("button", { name: "Cancel startup" })).toBeNull();
  await act(async () => { rejectStart(new Error("Startup failed")); });
  await screen.findByRole("alert");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep this draft");
  expect(cancelStartup).not.toHaveBeenCalled();
});

it("blocks a resumed protected session when the daemon changes or omits its immutable policy", async () => {
  sessionsStore.setState({
    sessions: { protected: session({ nativeId: "native" }) },
    order: ["protected"],
  });
  vi.mocked(resumeSession).mockResolvedValue({
    id: "protected",
    harness: "codex",
    gateway_route_id: null,
    state: "live",
  });
  await expect(resumeSessionAction("protected")).rejects.toMatchObject({
    code: "session_policy_unconfirmed",
  });
  expect(sessionsStore.getState().sessions.protected?.state).toBe("stopped");
  expect(sessionFeed.subscribeSession).not.toHaveBeenCalled();
});

it("ignores malformed and stale policy evidence even with a newer execution generation", () => {
  sessionsStore.setState({
    sessions: {
      protected: session({ executionGeneration: 2, executionRevision: 5, effectiveBinding: false }),
    },
  });
  const incoming = {
    session_id: "protected",
    execution_backend: "host",
    privacy_mode: "surrogate",
    policy_revision: 2,
    generation: 3,
    revision: 1,
    phase: "ready",
    effective_binding: true,
  } as const;
  applyExecutionStatus("protected", incoming);
  expect(sessionsStore.getState().sessions.protected?.effectiveBinding).toBe(false);
  applyExecutionStatus("protected", { ...incoming, policy_revision: Number.NaN });
  expect(sessionsStore.getState().sessions.protected?.executionGeneration).toBe(2);
});

it("keeps startup visible after delivery until the session route replaces it", async () => {
  preferencesStore.setState({ defaultModel: "fixture/model" });
  let finishStart!: (result: Awaited<ReturnType<typeof startSession>>) => void;
  vi.mocked(startSession).mockImplementation(() => new Promise((resolve) => { finishStart = resolve; }));
  render(<WelcomeComposer initialCwd="/workspace" />);
  await screen.findByText("Claude Code");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByLabelText("Send"));
  await act(async () => {
    finishStart({ id: "new", harness: "claude", gateway_route_id: null, state: "live" });
  });
  expect(sessionFeed.sendPrompt).toHaveBeenCalledWith("new", "Hello");
  expect(window.location.hash).toBe("#/session/new");
  expect(screen.getByRole("status").textContent).toBe("Thinking");
  expect(screen.getByText("Hello").className).toBe("tr-user-bubble");
  expect(screen.queryByRole("button", { name: "Cancel startup" })).toBeNull();
  expect(sessionsStore.getState().sessions.new).toMatchObject({ sending: false, awaitingResponse: true });
});

it("keeps Docker available independently of the selected permission mode", async () => {
  preferencesStore.setState({ defaultModel: "fixture/model" });

  render(<WelcomeComposer initialCwd="/workspace" />);
  await screen.findByText("Claude Code");
  chooseProtection(/^Docker sandbox/);
  fireEvent.click(screen.getByLabelText("Harness"));
  fireEvent.click(await screen.findByRole("button", { name: "Codex" }));
  expect(screen.getByLabelText("Permission mode").textContent).toContain("Ask for approval");
  expect(
    screen.queryByText("The harness sandbox is unavailable in this Docker environment."),
  ).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Do not weaken my permissions" },
  });
  expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Permission mode" }));
  expect(
    (screen.getByRole("button", { name: /^Ask for approval/ }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /^Full access/ }));
  expect(screen.getByLabelText("Permission mode").textContent).toContain("Full access");
  expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false);
});

it("shows the selected protection without claiming the agent is ready", () => {
  render(
    <SessionProtection
      session={session({
        state: "live",
        executionBackend: "docker",
        executionPhase: "ready",
        effectiveBinding: true,
      })}
    />,
  );
  expect(screen.queryByText(/Ready/)).toBeNull();
  const trigger = screen.getByRole("button", { name: "Session protection" });
  expect(trigger.textContent).toContain("Docker with pseudonymization");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog").textContent).not.toContain("Stop the session");
  fireEvent.click(screen.getByRole("button", { name: /^Standard/ }));
  expect(screen.getByRole("status").textContent).toContain("Stop the session");
  expect((screen.getByRole("switch", { name: /^Pseudonymized/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("shows a terminal execution failure in the composer context", () => {
  render(
    <SessionProtection
      session={session({ executionPhase: "failed", executionReason: "docker_network_unavailable" })}
    />,
  );
  expect(screen.getByRole("alert").textContent).not.toContain("error.");
  expect(screen.queryByText(/Ready/)).toBeNull();
});

it.each(["en", "fr"] as const)(
  "explains Docker security setup in %s without exposing an error key",
  async (locale) => {
    await initI18n(locale);
    render(
      <SessionProtection
        session={session({
          executionPhase: "blocked",
          executionReason: "docker_security_setup_required",
        })}
      />,
    );
    const message = screen.getByRole("alert").textContent;
    expect(message).toContain(locale === "en" ? "administrator" : "administrateur");
    expect(message).not.toContain("error.");
    expect(message).not.toContain("sudo");
    await initI18n("en");
  },
);

it("uses a readable fallback for unrecognized lifecycle errors", () => {
  expect(
    errorKey(new DaemonError({ code: "future_unknown_code", message: "Private diagnostics" })),
  ).toBe("error.unknown");
  expect(
    errorKey(new DaemonError({ code: "docker_security_setup_required", message: "Setup needed" })),
  ).toBe("error.docker_security_setup_required");
});

it("shows immediate resume work while the prior execution is stopped", async () => {
  const source = session({
    nativeId: "native",
    executionBackend: "docker",
    executionPhase: "stopped",
    sending: true,
    awaitingResponse: true,
  });
  sessionsStore.setState({ sessions: { protected: source }, order: ["protected"] });
  let complete!: (value: Awaited<ReturnType<typeof resumeSession>>) => void;
  vi.mocked(resumeSession).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = resumeSessionAction("protected");
  const current = sessionsStore.getState().sessions.protected!;
  expect(current.resumeStartedAt).toEqual(expect.any(Number));
  expect(current.state).toBe("stopped");
  expect(isSessionWorking(current)).toBe(true);
  render(<SessionProtection session={current} />);
  expect(screen.queryByText("Stopped")).toBeNull();
  complete({
    id: "protected",
    harness: "codex",
    state: "live",
    gateway_route_id: "route",
    execution_backend: "docker",
    privacy_mode: "surrogate",
    policy_revision: 3,
  });
  await pending;
  const resumed = sessionsStore.getState().sessions.protected!;
  expect(resumed.resumeStartedAt).toBeUndefined();
  expect(resumed.executionPhase).toBeUndefined();
  expect(isSessionWorking(resumed)).toBe(true);
});

it("clears resume feedback on a rejected startup without claiming a live session", async () => {
  sessionsStore.setState({
    sessions: { protected: session({ nativeId: "native", executionPhase: "stopped" }) },
    order: ["protected"],
  });
  vi.mocked(resumeSession).mockRejectedValue(
    new DaemonError({ code: "docker_security_setup_required", message: "Setup needed" }),
  );
  await expect(resumeSessionAction("protected")).rejects.toMatchObject({
    code: "docker_security_setup_required",
  });
  const current = sessionsStore.getState().sessions.protected!;
  expect(current.resumeStartedAt).toBeUndefined();
  expect(current.state).toBe("stopped");
  expect(isSessionWorking(current)).toBe(false);
});

it.each(["", "feature/search"])("creates a worktree with optional name %s and separate privacy", async (name) => {
  preferencesStore.setState({ defaultModel: "fixture/model" });
  vi.mocked(startSession).mockRejectedValue(new DaemonError({ code: "worktree_repository_required", message: "Synthetic refusal" }));
  render(<WelcomeComposer initialCwd="/workspace" />);
  await screen.findByText("Claude Code");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Build search" } });
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  fireEvent.click(screen.getByRole("button", { name: /^Worktree/ }));
  fireEvent.change(screen.getByPlaceholderText("Random name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByLabelText("Send"));
  await waitFor(() => expect(startSession).toHaveBeenCalled());
  const payload = vi.mocked(startSession).mock.calls[0]![0];
  expect(payload).toMatchObject({ worktree: true, execution_backend: "host", privacy_mode: "surrogate", cwd: "/workspace" });
  expect(payload.worktree_id).toBe(name || undefined);
  expect((await screen.findByRole("alert")).textContent).toContain("Git repository");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Build search");
});
