import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "@/features/transcript/Composer";
import { sessionsStore } from "@/stores/sessions";
import { providersStore } from "@/stores/providers";
import { initI18n } from "@/i18n";
import { setSessionModel } from "@/daemon/rest/sessions";

vi.mock("@/daemon/rest/sessions", () => ({ setSessionModel: vi.fn() }));
vi.mock("@/daemon/rest/providers", () => ({
  listProviders: vi.fn(async () => [{ name: "provider", kind: "custom", state: "verified" }]),
  listProviderModels: vi.fn(async () => []),
}));

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  providersStore.setState({
    providers: {
      provider: {
        name: "provider",
        kind: "custom",
        state: "verified",
        catalogState: "loaded",
        modelCatalog: [
          { id: "kimi", reasoning_efforts: ["max"], default_effort: null },
          { id: "gemma", reasoning_efforts: [], default_effort: null },
        ],
      },
    },
  });
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness: "opencode",
        state: "live",
        title: "Session",
        deleted: false,
        pendingApprovals: 0,
        model: "provider/kimi",
        reasoningEffort: "max",
      },
    },
    order: ["s1"],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("hides a stale effort as soon as the selected model has no reasoning", () => {
  render(<Composer sessionId="s1" />);
  expect(screen.getByLabelText("Model").textContent).toContain("max");
  act(() => sessionsStore.getState().applySessionPatch("s1", { model: "provider/gemma" }));
  expect(screen.getByLabelText("Model").textContent).not.toContain("max");
});

it("applies the effort returned with a model change, including explicit null", async () => {
  vi.mocked(setSessionModel).mockResolvedValue({
    model: "provider/gemma",
    reasoning_effort: null,
  } as Awaited<ReturnType<typeof setSessionModel>>);
  render(<Composer sessionId="s1" />);
  fireEvent.click(screen.getByLabelText("Model"));
  fireEvent.click(screen.getByRole("button", { name: /Change model/ }));
  fireEvent.click(screen.getByTitle("provider/gemma"));
  await waitFor(() => expect(sessionsStore.getState().sessions.s1?.reasoningEffort).toBeNull());
  expect(sessionsStore.getState().sessions.s1?.model).toBe("provider/gemma");
});
