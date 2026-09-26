import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionProtection } from "@/features/sessions/SessionProtection";
import { initI18n } from "@/i18n";
import { forkSession } from "@/daemon/rest/protection";
import { getSession } from "@/daemon/rest/sessions";
import type { SessionView } from "@/stores/sessions";

vi.mock("@/features/sessions/executionStatus", () => ({ useExecutionStatus: vi.fn() }));
vi.mock("@/daemon/rest/protection", () => ({ forkSession: vi.fn() }));
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
  policyConfirmed: true,
};
beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
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

it("keeps a running session read-only and explains how to change protection", () => {
  render(<SessionProtection session={{ ...session, state: "live" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Session protection" }));
  expect(
    (screen.getByRole("button", { name: /^Docker sandbox/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText("Stop the session to change its protection.")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});
