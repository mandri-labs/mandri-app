import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { request } from "@/daemon/rest/client";
import { listProviders } from "@/daemon/rest/providers";
import { modelSelection, nativeHarness, sessionModelRef } from "@/daemon/modelSelection";
import { rememberRuntimeCapabilities, runtimeCapabilitiesStore } from "@/daemon/runtimeCapabilities";
import { Composer, ModelMenu } from "@/features/transcript/Composer";
import { sessionsStore } from "@/stores/sessions";
import { nativeModelsStore } from "@/features/providers/nativeModels";
import { providersStore } from "@/stores/providers";
import { initI18n } from "@/i18n";

vi.mock("@/daemon/rest/client", () => ({ request: vi.fn() }));
vi.mock("@/daemon/rest/providers", () => ({
  listProviders: vi.fn(async () => []),
  listProviderModels: vi.fn(async () => []),
}));

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  providersStore.setState({ providers: {} });
  nativeModelsStore.setState({ catalogs: {} });
  rememberRuntimeCapabilities([
    ...["codex", "claude", "agy", "pi"].map((harness) => ({
      harness,
      capabilities: { model_sources: ["native", "gateway"] },
    })),
    { harness: "opencode", capabilities: { model_sources: ["gateway"] } },
  ]);
  vi.mocked(request).mockResolvedValue([
    {
      id: "gpt-native",
      display_name: "Native GPT",
      reasoning_efforts: ["high", "ultra"],
      default_effort: "high",
    },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function seedPiSearchModels(): void {
  const gatewayProviders = [
    { name: "gateway", kind: "openrouter", api_base: null, state: "verified" },
  ];
  vi.mocked(listProviders).mockResolvedValueOnce(gatewayProviders);
  providersStore.getState().hydrateProviders(gatewayProviders);
  providersStore.getState().setCatalog("gateway", [
    {
      id: "fab",
      display_name: "Claude Fable 5",
      reasoning_efforts: [],
      default_effort: null,
    },
  ]);
  vi.mocked(request).mockResolvedValue([
    {
      id: "anthropic/model-500",
      display_name: "Claude Fable 5",
      reasoning_efforts: [],
      default_effort: null,
    },
    {
      id: "opencode/model-510",
      display_name: "Claude Fable 5.1",
      reasoning_efforts: [],
      default_effort: null,
    },
    {
      id: "anthropic/model-450",
      display_name: "Claude Haiku 4.5",
      reasoning_efforts: [],
      default_effort: null,
    },
  ]);
}

it.each(["fab", "FAB"])(
  "searches friendly native model names with %s while preserving labels and origins",
  async (query) => {
    seedPiSearchModels();
    const select = vi.fn();
    render(<ModelMenu harness="pi" onSelect={select} />);
    await screen.findByTitle("native:pi/anthropic/model-500");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });

    expect(screen.getByText("Native models · Pi")).toBeTruthy();
    expect(screen.getByText("gateway")).toBeTruthy();
    const rows = screen.getAllByRole("option").filter((row) => row.hasAttribute("title"));
    expect(rows.map((row) => row.getAttribute("title"))).toEqual([
      "native:pi/anthropic/model-500",
      "native:pi/opencode/model-510",
      "gateway/fab",
    ]);
    expect(rows[0]?.textContent).toContain("Claude Fable 5");
    expect(rows[1]?.textContent).toContain("Claude Fable 5.1");
    expect(rows[2]?.textContent).toContain("Claude Fable 5");
    expect(rows[0]?.querySelector(".model-menu-hit")?.textContent).toBe("Fab");
    expect(screen.queryByTitle("native:pi/anthropic/model-450")).toBeNull();

    fireEvent.click(rows[0]!);
    expect(select).toHaveBeenLastCalledWith("native:pi/anthropic/model-500");
    fireEvent.click(rows[2]!);
    expect(select).toHaveBeenLastCalledWith("gateway/fab");
  },
);

it("keeps keyboard selection aligned with grouped native and gateway search results", async () => {
  seedPiSearchModels();
  const select = vi.fn();
  render(<ModelMenu harness="pi" onSelect={select} />);
  await screen.findByTitle("native:pi/anthropic/model-500");
  const search = screen.getByRole("combobox");
  fireEvent.change(search, { target: { value: "fab" } });

  fireEvent.keyDown(search, { key: "Enter" });
  expect(select).toHaveBeenLastCalledWith("native:pi/anthropic/model-500");
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(select).toHaveBeenLastCalledWith("native:pi/opencode/model-510");
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(select).toHaveBeenLastCalledWith("gateway/fab");
});

it("finds a native model by its technical ID without replacing its friendly label", async () => {
  seedPiSearchModels();
  const select = vi.fn();
  render(<ModelMenu harness="pi" onSelect={select} />);
  await screen.findByTitle("native:pi/opencode/model-510");
  const search = screen.getByRole("combobox");

  fireEvent.change(search, { target: { value: "opencode/model-510" } });

  const rows = screen.getAllByRole("option").filter((row) => row.hasAttribute("title"));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.getAttribute("title")).toBe("native:pi/opencode/model-510");
  expect(rows[0]?.textContent).toContain("Claude Fable 5.1");
  expect(screen.getByText("Native models · Pi")).toBeTruthy();
  fireEvent.keyDown(search, { key: "Enter" });
  expect(select).toHaveBeenCalledWith("native:pi/opencode/model-510");
});

it("shows native models without any configured gateway providers", async () => {
  const select = vi.fn();
  render(<ModelMenu harness="codex" cwd="/work" onSelect={select} />);
  expect(screen.getByText("Harness default")).toBeTruthy();
  fireEvent.click(await screen.findByText("Native GPT"));
  expect(select).toHaveBeenCalledWith("native:codex/gpt-native");
  expect(request).toHaveBeenCalledWith(
    "/v1/runtimes/codex/models",
    expect.objectContaining({ query: { cwd: "/work" } }),
  );
});

it("preserves ultra as a native reasoning choice", async () => {
  const effort = vi.fn();
  render(
    <ModelMenu
      harness="codex"
      currentModel="native:codex/gpt-native"
      currentEffort="high"
      onSelect={vi.fn()}
      onSelectEffort={effort}
    />,
  );
  const slider = await screen.findByRole("slider");
  fireEvent.change(slider, { target: { value: "1" } });
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  expect(effort).toHaveBeenCalledWith("ultra");
});

it("resolves an imported native model display name and reasoning levels", async () => {
  vi.mocked(request).mockResolvedValue([
    {
      id: "gpt-6-astra",
      display_name: "GPT-6 Astra",
      reasoning_efforts: ["high", "ultra"],
      default_effort: "high",
    },
  ]);
  sessionsStore.setState({
    sessions: {
      imported: {
        id: "imported",
        harness: "codex",
        state: "discovered",
        title: "Imported",
        deleted: false,
        pendingApprovals: 0,
        nativeId: "thread",
        externalBusy: false,
        availability: {
          owner: "unowned",
          activity: "idle",
          can_resume: true,
          can_release: false,
          can_restore: true,
          reason: null,
        },
        model: sessionModelRef({ harness: "codex", model: "gpt-6-astra", model_source: "native" }),
        reasoningEffort: "high",
      },
    },
    order: ["imported"],
  });
  render(<Composer sessionId="imported" />);
  expect(await screen.findByText("GPT-6 Astra")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Model"));
  const slider = await screen.findByRole("slider");
  expect(slider.getAttribute("max")).toBe("1");
  expect(screen.queryByText("gpt-6-astra")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

it("reuses the loaded catalog when the model menu is reopened", async () => {
  const view = render(<ModelMenu harness="codex" cwd="/work" onSelect={vi.fn()} />);
  await screen.findByText("Native GPT");
  view.unmount();
  render(<ModelMenu harness="codex" cwd="/work" onSelect={vi.fn()} />);
  expect(screen.getByText("Native GPT")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
});

it("loads a separate native catalog when the project changes", async () => {
  const view = render(<ModelMenu harness="codex" cwd="/work" onSelect={vi.fn()} />);
  await screen.findByText("Native GPT");
  view.rerender(<ModelMenu harness="codex" cwd="/other" onSelect={vi.fn()} />);
  await waitFor(() =>
    expect(nativeModelsStore.getState().catalogs["codex:/other"]?.state).toBe("loaded"),
  );
  expect(request).toHaveBeenCalledTimes(2);
});

it("does not leak Codex models into another harness catalog", async () => {
  const view = render(<ModelMenu harness="codex" onSelect={vi.fn()} />);
  await screen.findByText("Native GPT");
  view.rerender(<ModelMenu harness="opencode" onSelect={vi.fn()} />);
  expect(screen.queryByText("Native GPT")).toBeNull();
  expect(screen.queryByText("Harness default")).toBeNull();
});

it("keeps native default usable when catalog discovery fails", async () => {
  vi.mocked(request).mockRejectedValue(new Error("not logged in"));
  const select = vi.fn();
  render(<ModelMenu harness="claude" onSelect={select} />);
  await waitFor(() =>
    expect(nativeModelsStore.getState().catalogs["claude:"]?.state).toBe("unavailable"),
  );
  fireEvent.click(screen.getByText("Harness default"));
  expect(select).toHaveBeenCalledWith("native:claude/default");
});

it("discovers native model support from capabilities for an unregistered harness", async () => {
  runtimeCapabilitiesStore.setState({ entries: {} });
  vi.mocked(request).mockImplementation(async (path) => path === "/v1/runtimes"
    ? [{ harness: "future-harness", capabilities: { model_sources: ["gateway", "native"] } }]
    : [{ id: "provider/model", display_name: "Future native model", reasoning_efforts: [], default_effort: null }]);
  const select = vi.fn();
  render(<ModelMenu harness="future-harness" onSelect={select} />);
  fireEvent.click(await screen.findByText("Future native model"));
  expect(select).toHaveBeenCalledWith("native:future-harness/provider/model");
  expect(request).toHaveBeenCalledWith("/v1/runtimes");
  expect(request).toHaveBeenCalledWith("/v1/runtimes/future-harness/models", expect.any(Object));
});

it("does not infer native support from a known harness name or remove gateway providers while capabilities load", async () => {
  runtimeCapabilitiesStore.setState({ entries: {} });
  seedPiSearchModels();
  let resolve!: (rows: unknown) => void;
  vi.mocked(request).mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<ModelMenu harness="pi" onSelect={vi.fn()} />);
  expect(screen.getByTitle("gateway/fab")).toBeTruthy();
  expect(screen.queryByText("Native models · Pi")).toBeNull();
  resolve([{ harness: "pi", capabilities: { model_sources: ["gateway"] } }]);
  await waitFor(() => expect(runtimeCapabilitiesStore.getState().entries.pi?.modelSources).toEqual(["gateway"]));
  expect(screen.queryByText("Native models · Pi")).toBeNull();
  expect(screen.getByTitle("gateway/fab")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
});

it("round trips native and gateway selections without rewriting native aliases", () => {
  expect(modelSelection("native:claude/fable")).toEqual({ model: "fable", model_source: "native" });
  expect(modelSelection("openrouter/anthropic/model")).toEqual({
    model: "openrouter/anthropic/model",
    model_source: "gateway",
  });
  expect(sessionModelRef({ harness: "claude", model: "fable", model_source: "native" })).toBe(
    "native:claude/fable",
  );
  expect(sessionModelRef({ harness: "claude", model: null, model_source: "native" })).toBe(
    "native:claude/default",
  );
  expect(nativeHarness("native:codex/gpt-native")).toBe("codex");
  expect(nativeHarness("openrouter/model")).toBeUndefined();
});
