import type { CommandTransport } from "@/features/commands/service";
import { request } from "@/daemon/rest/client";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { attachmentDrafts, filesFor } from "@/features/transcript/attachments";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DaemonError } from "@/daemon/errors";
import { listFsDir, listFsProjects, listFsRoots } from "@/daemon/rest/fs";
import { listProviders, listProviderModels } from "@/daemon/rest/providers";
import { listRuntimes, startSession } from "@/daemon/rest/runtime";
import { initI18n } from "@/i18n";
import { connectionStore } from "@/stores/connection";
import { preferencesStore } from "@/stores/preferences";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { readPendingUsers } from "@/features/transcript/pendingUserStorage";
import { restoreDelivery } from "@/features/transcript/promptDelivery";
import { WelcomeComposer } from "@/features/sessions/WelcomeComposer";

vi.mock("@/daemon/rest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/daemon/rest/client")>()),
  request: vi.fn(async () => []),
}));

vi.mock("@/daemon/rest/runtime", () => ({
  listRuntimes: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  resumeSession: vi.fn(),
}));

vi.mock("@/daemon/rest/fs", () => ({
  listFsRoots: vi.fn(),
  listFsDir: vi.fn(),
  browseFsTree: vi.fn(),
  listFsProjects: vi.fn(),
}));

vi.mock("@/daemon/rest/providers", () => ({
  listProviders: vi.fn(),
  listProviderModels: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  verifyProvider: vi.fn(),
}));

const listRuntimesMock = vi.mocked(listRuntimes);
const startSessionMock = vi.mocked(startSession);
const listFsRootsMock = vi.mocked(listFsRoots);
const listFsDirMock = vi.mocked(listFsDir);
const listFsProjectsMock = vi.mocked(listFsProjects);

const RUNTIMES = [
  { harness: "claude", installed: true, version: "2.1.0", degraded: false },
  { harness: "codex", installed: false, version: null, degraded: false },
];

const SESSION_PAYLOAD = {
  id: "session-1",
  harness: "claude",
  gateway_route_id: "route-1",
  state: "live",
  project_path: "D:/Dev/alpha",
};

async function pickFolder(): Promise<void> {
  fireEvent.click(screen.getByLabelText("Working folder"));
  await waitFor(() => {
    expect(listFsProjectsMock).toHaveBeenCalled();
  });
  fireEvent.click(await screen.findByTitle("D:/Dev/alpha"));
  await screen.findByText("alpha");
}

async function submitPrompt(text: string): Promise<void> {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByLabelText("Send"));
}

beforeAll(async () => {
  await initI18n("en");
});

beforeEach(() => {
  localStorage.clear();
  connectionStore.setState({ status: "online" });
  attachmentDrafts.setState({ drafts: {}, errors: {} });
  transcriptStore.getState().resetTranscripts();
  window.location.hash = "";
  preferencesStore.setState({
    defaultHarness: undefined,
    defaultModel: undefined,
    defaultEffort: null,
  });
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
  listRuntimesMock.mockResolvedValue(RUNTIMES);
  startSessionMock.mockResolvedValue(SESSION_PAYLOAD);
  listFsRootsMock.mockResolvedValue([
    { name: "Dev", path: "D:/Dev", is_dir: true, size: null, modified_at: null },
  ]);
  listFsDirMock.mockResolvedValue([
    { name: "alpha", path: "D:/Dev/alpha", is_dir: true, size: null, modified_at: null },
  ]);
  listFsProjectsMock.mockResolvedValue(["D:/Dev/alpha"]);
  vi.mocked(listProviders).mockResolvedValue([]);
  vi.mocked(listProviderModels).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WelcomeComposer", () => {
  it("waits for the daemon before loading runtimes", async () => {
    connectionStore.setState({ status: "connecting" });
    render(<WelcomeComposer />);
    expect(listRuntimesMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      connectionStore.getState().setStatus("online");
    });
    await screen.findByText("Claude Code");
    expect(listRuntimesMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a runtime error and reloads after reconnecting", async () => {
    listRuntimesMock.mockRejectedValueOnce(new Error("Network request failed"));
    render(<WelcomeComposer />);
    await screen.findByRole("alert");
    await act(async () => {
      connectionStore.getState().setStatus("reconnecting");
    });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      connectionStore.getState().setStatus("online");
    });
    await screen.findByText("Claude Code");
    expect(listRuntimesMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("preserves the selected harness and permissions when reconnecting", async () => {
    listRuntimesMock.mockResolvedValue([
      RUNTIMES[0]!,
      { harness: "codex", installed: true, version: "1.0", degraded: false },
    ]);
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    fireEvent.click(screen.getByLabelText("Harness"));
    fireEvent.click(screen.getByRole("button", { name: /Codex/ }));
    fireEvent.click(screen.getByLabelText("Permission mode"));
    fireEvent.click(screen.getByRole("button", { name: /^Full access/ }));
    await act(async () => {
      connectionStore.getState().setStatus("reconnecting");
    });
    await act(async () => {
      connectionStore.getState().setStatus("online");
    });
    expect(screen.getByLabelText("Harness").textContent).toContain("Codex");
    expect(screen.getByLabelText("Permission mode").textContent).toContain("Full access");
  });

  it("ignores a late runtime failure from a disconnected request", async () => {
    let reject!: (error: Error) => void;
    listRuntimesMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    render(<WelcomeComposer />);
    await act(async () => {
      connectionStore.getState().setStatus("reconnecting");
    });
    await act(async () => {
      connectionStore.getState().setStatus("online");
    });
    await screen.findByText("Claude Code");
    await act(async () => {
      reject(new Error("Old request failed"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["host", "docker"] as const)(
    "shows the first message and status immediately while %s starts",
    async (backend) => {
      let rejectStart!: (error: Error) => void;
      startSessionMock.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectStart = reject;
          }),
      );
      preferencesStore.setState({ defaultModel: "fixture/model" });
      render(
        <WelcomeComposer
          initialCwd="D:/Dev/alpha"
          initialProtection={backend === "docker" ? "docker" : "standard"}
        />,
      );
      await screen.findByText("Claude Code");
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Inspect the workspace" } });
      fireEvent.click(screen.getByLabelText("Send"));
      // Assert synchronously, before the startup request can resolve.
      expect(screen.getByText("Inspect the workspace").className).toBe("tr-user-bubble");
      expect(screen.getByRole("status").textContent).toBe(
        backend === "docker" ? "Preparing the selected execution environment…" : "Thinking",
      );
      expect(screen.queryByRole("button", { name: "Cancel startup" })).toBeNull();
      await act(async () => {
        rejectStart(new Error("unavailable"));
      });
      await screen.findByRole("alert");
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "Inspect the workspace",
      );
      expect(document.querySelector(".transcript-activity")).toBeNull();
    },
  );

  it.each([
    ["codex", "Ask for approval", "Full access", "full-access"],
    ["opencode", "Standard permissions", "Automatic", "auto"],
  ])("submits the native permission profile for %s", async (harness, initial, label, mode) => {
    listRuntimesMock.mockResolvedValue([
      { harness, installed: true, version: "1.0", degraded: false },
    ]);
    startSessionMock.mockResolvedValue({ ...SESSION_PAYLOAD, harness, mode });
    render(<WelcomeComposer />);
    await waitFor(() =>
      expect(screen.getByLabelText("Permission mode").textContent).toContain(initial),
    );
    fireEvent.click(screen.getByLabelText("Permission mode"));
    const option = await screen.findByText(label);
    fireEvent.click(option);
    await pickFolder();
    await submitPrompt("Inspect the project");
    await waitFor(() =>
      expect(startSessionMock).toHaveBeenCalledWith({
        execution_backend: "host",
        privacy_mode: "none",
        operation_id: expect.any(String),
        harness,
        mode,
        model: "",
        cwd: "D:/Dev/alpha",
      }),
    );
  });

  it("renders the greeting with picker chips and a gated send button", async () => {
    render(<WelcomeComposer />);
    expect(screen.getByText("What shall we build?")).toBeTruthy();
    await screen.findByText("Claude Code");
    expect(screen.getByLabelText("Harness")).toBeTruthy();
    expect(screen.getByLabelText("Model")).toBeTruthy();
    expect(screen.getByLabelText("Working folder")).toBeTruthy();
    const send = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("prefills the harness with the first installed runtime", async () => {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    expect(screen.queryByText("Codex")).toBeNull();
  });

  it("lists unavailable harnesses as disabled with a reason", async () => {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    fireEvent.click(screen.getByLabelText("Harness"));
    expect(await screen.findByText("Not installed")).toBeTruthy();
    const codexRow = screen.getByRole("button", { name: /Codex/ }) as HTMLButtonElement;
    expect(codexRow.disabled).toBe(true);
  });

  it("accepts a multi-segment model ref from the model menu", async () => {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    fireEvent.click(screen.getByLabelText("Model"));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "openrouter/z-ai/glm-5.3-flash" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("glm-5.3-flash")).toBeTruthy();
    expect(screen.getByText("openrouter/z-ai/")).toBeTruthy();
  });

  it("preserves a manually selected model and reasoning across every protection mode", async () => {
    preferencesStore.setState({ defaultModel: "openai/saved", defaultEffort: "low" });
    vi.mocked(listProviders).mockResolvedValue([
      { name: "openai", kind: "openai", api_base: null, state: "verified" },
    ]);
    vi.mocked(listProviderModels).mockResolvedValue([
      { id: "gpt-5", reasoning_efforts: ["low", "high"], default_effort: "low" },
    ]);
    render(<WelcomeComposer initialCwd="/workspace" />);
    await screen.findByText("Claude Code");
    fireEvent.click(screen.getByLabelText("Model"));
    fireEvent.click(await screen.findByText("Change model"));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "gpt" } });
    await screen.findByTitle("openai/gpt-5");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByLabelText("Model"));
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.pointerUp(slider);
    fireEvent.keyDown(slider, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
    for (const name of [/^Docker sandbox/, /^Worktree/, /^Standard/]) {
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.click(screen.getByRole("switch"));
      expect(screen.getByLabelText("Model").textContent).toContain("gpt-5");
      expect(screen.getByLabelText("Model").textContent).toContain("high");
    }
  });

  it("keeps an incompatible native model visible and blocks sending until corrected", async () => {
    preferencesStore.setState({ defaultModel: "native:claude/default" });
    render(<WelcomeComposer initialCwd="/workspace" />);
    await screen.findByText("Claude Code");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Inspect" } });
    fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
    fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
    expect(screen.getByLabelText("Model").textContent).toContain("default");
    expect(screen.getByRole("status").textContent).toContain("Choose a gateway model");
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Standard/ }));
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false);
  });

  it("starts a session and navigates to it on submit", async () => {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    await submitPrompt("Ship the release");
    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledWith({
        execution_backend: "host",
        privacy_mode: "none",
        operation_id: expect.any(String),
        harness: "claude",
        model: "",
        cwd: "D:/Dev/alpha",
        mode: "default",
      });
    });
    await waitFor(() => {
      expect(window.location.hash).toBe("#/session/session-1");
    });
  });

  it("submits the selected mode with the session start", async () => {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    fireEvent.click(screen.getByLabelText("Permission mode"));
    fireEvent.click(await screen.findByRole("button", { name: /^Plan / }));
    await pickFolder();
    await submitPrompt("Plan first");
    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledWith({
        execution_backend: "host",
        privacy_mode: "none",
        operation_id: expect.any(String),
        harness: "claude",
        model: "",
        cwd: "D:/Dev/alpha",
        mode: "plan",
      });
    });
  });

  it("renders the mapped daemon error when the start fails", async () => {
    startSessionMock.mockRejectedValue(
      new DaemonError({ code: "harness_not_installed", message: "claude missing" }),
    );
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    await submitPrompt("Ship the release");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The required harness is not installed. Install it before starting a session.",
    );
    expect(window.location.hash).toBe("");
  });

  it("focuses the textarea when the focus-composer event fires", async () => {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(textarea);
    window.dispatchEvent(new CustomEvent("mandri:focus-composer"));
    expect(document.activeElement).toBe(textarea);
  });

  it("starts a session with the effort chosen from the thinking section", async () => {
    vi.mocked(listProviders).mockResolvedValue([
      { name: "openai", kind: "openai", api_base: null, state: "verified" },
    ]);
    vi.mocked(listProviderModels).mockResolvedValue([
      { id: "gpt-5", reasoning_efforts: ["low", "high"], default_effort: "low" },
    ]);
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    fireEvent.click(screen.getByLabelText("Model"));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "gpt" } });
    await screen.findByTitle("openai/gpt-5");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("(low)")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("Model"));
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.pointerUp(slider);
    expect(screen.getByText("(high)")).toBeTruthy();
    await submitPrompt("Ship the release");
    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledWith({
        execution_backend: "host",
        privacy_mode: "none",
        operation_id: expect.any(String),
        harness: "claude",
        model: "openai/gpt-5",
        cwd: "D:/Dev/alpha",
        mode: "default",
        effort: "high",
      });
    });
  });

  it("passes saved model and reasoning to new sessions without opening the menu", async () => {
    preferencesStore.setState({
      defaultHarness: "claude",
      defaultModel: "openai/gpt-5",
      defaultEffort: "high",
    });
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    expect(screen.getByText("(high)")).toBeTruthy();
    await pickFolder();
    await submitPrompt("Inspect the project");
    await waitFor(() =>
      expect(startSessionMock).toHaveBeenCalledWith({
        execution_backend: "host",
        privacy_mode: "none",
        operation_id: expect.any(String),
        harness: "claude",
        model: "openai/gpt-5",
        effort: "high",
        cwd: "D:/Dev/alpha",
        mode: "default",
      }),
    );
  });

  it("omits the effort from the start body when none is set", async () => {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    await submitPrompt("Ship the release");
    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledWith({
        execution_backend: "host",
        privacy_mode: "none",
        operation_id: expect.any(String),
        harness: "claude",
        model: "",
        cwd: "D:/Dev/alpha",
        mode: "default",
      });
    });
    const body = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.hasOwn(body, "effort")).toBe(false);
  });
});

it("uploads a file-only first message to the created session", async () => {
  const send = vi
    .spyOn(sessionFeed, "sendPrompt")
    .mockResolvedValue({ state: "queued", code: null });
  const subscribe = vi.spyOn(sessionFeed, "subscribeSession").mockImplementation(() => {});
  vi.mocked(request).mockResolvedValue({
    id: "attachment",
    reference: "[notes.txt](/session/notes.txt)",
  });
  try {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["notes"], "notes.txt")] },
    });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(send).toHaveBeenCalledWith("session-1", "", ["attachment"]));
    expect(request).toHaveBeenCalledWith(
      "/v1/sessions/session-1/attachments",
      expect.objectContaining({ method: "POST", query: { name: "notes.txt" } }),
    );
    expect(filesFor("welcome")).toHaveLength(0);
    expect(filesFor("session-1")).toHaveLength(0);
  } finally {
    send.mockRestore();
    subscribe.mockRestore();
  }
});

it("shows commands before a session exists and runs a unique match through the native path", async () => {
  const command = {
    id: "discovered:check",
    name: "workspace-check",
    description: "Check the workspace",
    aliases: [],
    kind: "command",
  };
  const transport: CommandTransport = {
    catalog: vi.fn(async () => ({ commands: [command] })),
    invoke: vi.fn(async (sessionId, invocationId) => ({
      session_id: sessionId,
      invocation_id: invocationId,
      command,
      state: "running" as const,
      cancellable: false,
    })),
    list: vi.fn(async () => []),
    cancel: vi.fn(),
  };
  const send = vi
    .spyOn(sessionFeed, "sendPrompt")
    .mockResolvedValue({ state: "queued", code: null });
  const subscribe = vi.spyOn(sessionFeed, "subscribeSession").mockImplementation(() => {});
  try {
    render(<WelcomeComposer initialCwd="D:/Dev/alpha" commands={transport} />);
    await screen.findByText("Claude Code");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/wsc exact arguments" } });
    await screen.findByRole("option", { name: /workspace-check/ });
    expect(startSessionMock).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await waitFor(() =>
      expect(transport.invoke).toHaveBeenCalledWith(
        "session-1",
        expect.any(String),
        "discovered:check",
        "exact arguments",
      ),
    );
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.hash).toBe("#/session/session-1"));
  } finally {
    send.mockRestore();
    subscribe.mockRestore();
  }
});

it("does not turn an unknown slash command into the first prompt", async () => {
  const transport: CommandTransport = {
    catalog: vi.fn(async () => ({ commands: [] })),
    invoke: vi.fn(),
    list: vi.fn(async () => []),
    cancel: vi.fn(),
  };
  render(<WelcomeComposer initialCwd="D:/Dev/alpha" commands={transport} />);
  await screen.findByText("Claude Code");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/missing" } });
  await screen.findByText(/has not exposed any commands/);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  fireEvent.click(screen.getByLabelText("Send"));
  expect(startSessionMock).not.toHaveBeenCalled();
  expect(transport.invoke).not.toHaveBeenCalled();
});

it("requires a working folder only when executing a discovered command", async () => {
  const command = {
    id: "discovered:check",
    name: "check",
    description: "Check",
    aliases: [],
    kind: "command",
  };
  const transport: CommandTransport = {
    catalog: vi.fn(async () => ({ commands: [command] })),
    invoke: vi.fn(),
    list: vi.fn(async () => []),
    cancel: vi.fn(),
  };
  render(<WelcomeComposer commands={transport} />);
  await screen.findByText("Claude Code");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/check" } });
  await screen.findByRole("option", { name: /Check/ });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await screen.findByRole("alert");
  expect(startSessionMock).not.toHaveBeenCalled();
  expect(transport.invoke).not.toHaveBeenCalled();
});

it("integrates the initial image into the bubble before session creation and upload finish", async () => {
  let finishStart!: (value: typeof SESSION_PAYLOAD) => void;
  let finishUpload!: (value: unknown) => void;
  startSessionMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishStart = resolve;
      }),
  );
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
  );
  const send = vi
    .spyOn(sessionFeed, "sendPrompt")
    .mockResolvedValue({ state: "queued", code: null });
  const subscribe = vi.spyOn(sessionFeed, "subscribeSession").mockImplementation(() => {});
  try {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "capture.png", {
      type: "image/png",
    });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await submitPrompt("Describe this");
    expect(document.querySelector(".tr-user-bubble")?.textContent).toContain("capture.png");
    expect(document.querySelector(".attachment-chips")).toBeNull();
    expect(screen.queryByText("Sending files…")).toBeNull();
    await act(async () => finishStart(SESSION_PAYLOAD));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const node = transcriptStore.getState().transcripts["session-1"]!.pendingUsers!.at(-1)!.node;
    expect(node.images?.[0]?.file).toBe(file);
    expect(send).not.toHaveBeenCalled();
    await act(async () =>
      finishUpload({ id: "image", reference: "[capture.png](/files/capture.png)" }),
    );
    await waitFor(() => expect(send).toHaveBeenCalledWith("session-1", "Describe this", ["image"]));
  } finally {
    send.mockRestore();
    subscribe.mockRestore();
  }
});

it("restores welcome text and every setting without additional UI", async () => {
  const { composerStorageKey, writeComposerStorage } = await import("@/lib/composerStorage");
  const saved = {
    text: "Continue this prompt",
    harness: "claude",
    mode: "plan",
    protection: "worktree_surrogate",
    worktreeId: "saved-tree",
    model: "provider/saved-model",
    effort: "high",
    cwd: "D:/Dev/saved",
  };
  writeComposerStorage(composerStorageKey("welcome"), saved);
  const first = render(<WelcomeComposer />);
  await waitFor(() => expect(listRuntimesMock).toHaveBeenCalled());
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(saved.text);
  expect(JSON.parse(localStorage.getItem(composerStorageKey("welcome"))!)).toEqual(saved);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edited prompt" } });
  first.unmount();
  render(<WelcomeComposer />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Edited prompt");
  expect(JSON.parse(localStorage.getItem(composerStorageKey("welcome"))!)).toEqual({
    ...saved,
    text: "Edited prompt",
  });
});

it("retains the first message after a lost acknowledgement and recovers it after reload", async () => {
  const send = vi
    .spyOn(sessionFeed, "sendPrompt")
    .mockRejectedValueOnce(
      new DaemonError({ code: "delivery_unknown", message: "Acknowledgement lost" }),
    );
  try {
    sessionsStore.setState({ drafts: {} });
    const view = render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    await submitPrompt("Keep my first message");
    await waitFor(() => expect(readPendingUsers("session-1")[0]?.delivery?.state).toBe("unknown"));
    expect(send).toHaveBeenCalledTimes(1);
    view.unmount();
    transcriptStore.getState().resetTranscripts();
    transcriptStore.getState().setNodes("session-1", [], []);
    const key = readPendingUsers("session-1")[0]!.node.key!;
    expect(await restoreDelivery("session-1", key)).toBe(true);
    expect(sessionsStore.getState().drafts["session-1"]).toBe("Keep my first message");
    expect(send).toHaveBeenCalledTimes(1);
    expect(readPendingUsers("session-1")).toHaveLength(0);
  } finally {
    send.mockRestore();
  }
});

it("restores the first message and files when stopped during upload", async () => {
  let finishUpload!: (value: unknown) => void;
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
  );
  const send = vi
    .spyOn(sessionFeed, "sendPrompt")
    .mockResolvedValue({ state: "queued", code: null });
  const subscribe = vi.spyOn(sessionFeed, "subscribeSession").mockImplementation(() => {});
  try {
    sessionsStore.setState({ drafts: {} });
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["notes"], "notes.txt")] },
    });
    await submitPrompt("Keep my notes");
    await waitFor(() => expect(request).toHaveBeenCalled());
    act(() =>
      sessionsStore.getState().ingestFrame({
        topic: "sessions.all",
        seq: 1,
        ts: 1,
        source: "mandri",
        raw: { type: "session_stopped", session_id: "session-1", cause: "user" },
      }),
    );
    await act(async () => finishUpload({ id: "file", reference: "[notes.txt](/files/notes.txt)" }));
    await waitFor(() => expect(sessionsStore.getState().drafts["session-1"]).toBe("Keep my notes"));
    expect(await filesFor("session-1")[0]!.file.text()).toBe("notes");
    expect(send).not.toHaveBeenCalled();
    expect(readPendingUsers("session-1")).toHaveLength(0);
  } finally {
    send.mockRestore();
    subscribe.mockRestore();
  }
});

it("delivers the first prompt and files with unavailable desktop local storage", async () => {
  const send = vi
    .spyOn(sessionFeed, "sendPrompt")
    .mockResolvedValue({ state: "queued", code: null });
  const subscribe = vi.spyOn(sessionFeed, "subscribeSession").mockImplementation(() => {});
  try {
    render(<WelcomeComposer />);
    await screen.findByText("Claude Code");
    await pickFolder();
    const storage = localStorage;
    vi.stubGlobal(
      "localStorage",
      new Proxy(storage, {
        get(target, key) {
          if (key === "setItem")
            return () => {
              throw new DOMException("Full", "QuotaExceededError");
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    );
    vi.mocked(request).mockResolvedValue({
      id: "file",
      reference: "[notes.txt](/files/notes.txt)",
    });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["notes"], "notes.txt")] },
    });
    await submitPrompt("First prompt");
    await waitFor(() =>
      expect(send).toHaveBeenCalledExactlyOnceWith("session-1", "First prompt", ["file"]),
    );
    await waitFor(() =>
      expect(
        transcriptStore.getState().transcripts["session-1"]?.localUsers?.[0]?.delivery?.state,
      ).toBe("accepted"),
    );
  } finally {
    vi.unstubAllGlobals();
    send.mockRestore();
    subscribe.mockRestore();
  }
});
