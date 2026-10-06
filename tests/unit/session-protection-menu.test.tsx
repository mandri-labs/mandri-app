import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionProtection } from "@/features/sessions/SessionProtection";
import { initI18n } from "@/i18n";
import { forkSession, setSessionPrivacy } from "@/daemon/rest/protection";
import { getSession } from "@/daemon/rest/sessions";
import { sessionsStore, type SessionView } from "@/stores/sessions";

vi.mock("@/features/sessions/executionStatus", () => ({ useExecutionStatus: vi.fn() }));
vi.mock("@/daemon/rest/protection", () => ({ forkSession: vi.fn(), setSessionPrivacy: vi.fn() }));
vi.mock("@/daemon/rest/sessions", () => ({ getSession: vi.fn() }));

const session: SessionView = {
  id: "managed",
  harness: "codex",
  state: "stopped",
  title: "Synthetic session",
  deleted: false,
  pendingApprovals: 0,
  executionBackend: "host",
  privacyMode: "none",
  executionPhase: "stopped",
  interactionMode: "full-access",
  model: "fixture/model",
  policyRevision: 1,
  policyConfirmed: true,
};
beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  sessionsStore.setState({ sessions: { managed: session }, order: ["managed"] });
});
afterEach(cleanup);

it.each([
  { state: "discovered" as const },
  { availability: { owner: "external" as const, activity: "idle" as const } },
  { externalBusy: true },
])("hides protection for a native session (%j)", (extra) => {
  const { container } = render(<SessionProtection session={{ ...session, ...extra }} />);
  expect(container.textContent).toBe("");
  expect(screen.queryByRole("button")).toBeNull();
});

it("offers all protections in one dropdown without a separate change action or status", () => {
  render(<SessionProtection session={session} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByText("Stopped")).toBeNull();
  expect(screen.queryByText("Change protection in a new session")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Standard/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
  expect(forkSession).not.toHaveBeenCalled();
  expect(screen.getByText(/current session keeps its policy and history/)).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button").textContent).toContain("Standard");
});

it("creates the selected protection only on apply, preserves permissions, and opens the confirmed session", async () => {
  vi.mocked(forkSession).mockResolvedValue({
    id: "forked",
    execution_backend: "docker",
    privacy_mode: "none",
    policy_revision: 1,
  } as Awaited<ReturnType<typeof forkSession>>);
  vi.mocked(getSession).mockResolvedValue({
    id: "forked",
    harness: "codex",
    state: "stopped",
    title: "Forked",
    project_path: "/workspace",
    model: "fixture/model",
    native_id: null,
    created_at: 0,
    updated_at: 0,
    execution_backend: "docker",
    privacy_mode: "none",
    policy_revision: 1,
  });
  render(<SessionProtection session={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
  await waitFor(() =>
    expect(forkSession).toHaveBeenCalledWith("managed", {
      execution_backend: "docker",
      privacy_mode: "none",
      mode: "full-access",
      operation_id: expect.any(String),
    }),
  );
  await waitFor(() => expect(window.location.hash).toBe("#/session/forked"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps execution context read-only while a session is running", () => {
  render(<SessionProtection session={{ ...session, state: "live" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  expect(
    screen.getByRole("button", { name: /^Docker sandbox/ }).getAttribute("aria-disabled"),
  ).toBe("true");
  expect(screen.queryByText("Stop the session to change its execution context.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Standard/ }));
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
  expect(screen.getByRole("status").textContent).toBe(
    "Stop the session to change its execution context.",
  );
  expect(screen.getByRole("button", { name: /^Standard/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.queryByRole("button", { name: "Create new session" })).toBeNull();
  expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
});

it.each([
  ["stopped", "none", "surrogate"],
  ["live", "none", "surrogate"],
  ["stopped", "surrogate", "none"],
  ["live", "surrogate", "none"],
] as const)(
  "toggles privacy in place for a %s gateway session from %s to %s",
  async (state, initial, next) => {
    vi.mocked(setSessionPrivacy).mockResolvedValue({
      id: session.id,
      harness: session.harness,
      state,
      title: session.title,
      project_path: "/workspace",
      model: session.model ?? null,
      model_source: "gateway",
      native_id: "native-session",
      created_at: 0,
      updated_at: 0,
      execution_backend: "host",
      privacy_mode: next,
      policy_revision: 2,
    });
    render(<SessionProtection session={{ ...session, state, privacyMode: initial }} />);
    fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
    if (state === "live") {
      fireEvent.click(screen.getByRole("button", { name: /^Docker sandbox/ }));
      expect(screen.getByRole("status")).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(setSessionPrivacy).toHaveBeenCalledWith("managed", next));
    await waitFor(() => expect(sessionsStore.getState().sessions.managed?.policyRevision).toBe(2));
    expect(sessionsStore.getState().sessions.managed?.privacyMode).toBe(next);
    expect(screen.queryByText("Stop the session to change its execution context.")).toBeNull();
    expect(forkSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create new session" })).toBeNull();
    expect(window.location.hash).toBe("");
  },
);

it("disables privacy for native models", () => {
  render(<SessionProtection session={{ ...session, model: "native:codex/default" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("switch"));
  expect(setSessionPrivacy).not.toHaveBeenCalled();
});

it("preserves privacy and shows an error when the daemon refuses the change", async () => {
  vi.mocked(setSessionPrivacy).mockRejectedValue(new Error("Unavailable"));
  render(<SessionProtection session={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  fireEvent.click(screen.getByRole("switch"));
  await screen.findByRole("alert");
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  expect(sessionsStore.getState().sessions.managed?.privacyMode).toBe("none");
});
