import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { listProviders, listProviderModels } from "@/daemon/rest/providers";
import { initI18n } from "@/i18n";
import { providersStore } from "@/stores/providers";
import { ModelMenu } from "@/features/transcript/Composer";

vi.mock("@/daemon/rest/providers", () => ({
  listProviders: vi.fn(),
  listProviderModels: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  verifyProvider: vi.fn(),
}));

const listProvidersMock = vi.mocked(listProviders);
const listProviderModelsMock = vi.mocked(listProviderModels);

const PROVIDER_ROWS = [
  { name: "openai", kind: "openai", api_base: null, state: "verified" },
  { name: "anthropic", kind: "anthropic", api_base: null, state: "verified" },
];

const OPENAI_MODELS = [
  { id: "gpt-5", reasoning_efforts: ["low", "high"], default_effort: "low" },
  { id: "o4-mini", reasoning_efforts: [], default_effort: null },
];

const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4", reasoning_efforts: [], default_effort: null },
];

function seedStore(): void {
  providersStore.getState().hydrateProviders(PROVIDER_ROWS);
  providersStore.getState().setCatalog("openai", OPENAI_MODELS);
  providersStore.getState().setCatalog("anthropic", ANTHROPIC_MODELS);
}

beforeAll(async () => {
  await initI18n("en");
});

beforeEach(() => {
  providersStore.setState({ providers: {}, routes: [], routesLoaded: false });
  seedStore();
  listProvidersMock.mockResolvedValue(PROVIDER_ROWS);
  listProviderModelsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModelMenu", () => {
  it("groups models by provider when the search is empty", async () => {
    render(<ModelMenu onSelect={() => undefined} />);
    expect(screen.getByText("openai")).toBeTruthy();
    expect(screen.getByText("anthropic")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("gpt-5")).toBeTruthy();
    });
    expect(screen.getByText("claude-sonnet-4")).toBeTruthy();
  });

  it("focuses the search input on open", () => {
    render(<ModelMenu onSelect={() => undefined} />);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search a model…");
  });

  it("filters and ranks models by fuzzy query", async () => {
    render(<ModelMenu onSelect={() => undefined} />);
    const search = screen.getByLabelText("Search a model…");
    fireEvent.change(search, { target: { value: "gpt" } });
    await waitFor(() => {
      expect(screen.getByTitle("openai/gpt-5")).toBeTruthy();
    });
    expect(screen.queryByTitle("anthropic/claude-sonnet-4")).toBeNull();
    expect(screen.queryByTitle("openai/o4-mini")).toBeNull();
    const options = screen.getAllByRole("option");
    expect(options[0]?.getAttribute("title")).toBe("openai/gpt-5");
    expect(options[0]?.querySelector(".model-menu-hit")?.textContent).toBe("gpt");
  });

  it("matches by provider name and shows provider hits", async () => {
    render(<ModelMenu onSelect={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Search a model…"), {
      target: { value: "anthropic" },
    });
    const options = await screen.findAllByRole("option");
    const modelRows = options.filter((option) => option.getAttribute("title") !== null);
    expect(modelRows).toHaveLength(1);
    expect(modelRows[0]?.getAttribute("title")).toBe("anthropic/claude-sonnet-4");
    expect(
      screen
        .getByText("anthropic")
        .closest(".model-menu-provider")
        ?.querySelector(".model-menu-hit")?.textContent,
    ).toBe("anthropic");
  });

  it("searches gateway display names when they differ from the technical model ID", async () => {
    providersStore.getState().setCatalog("openai", [
      {
        id: "model-700",
        display_name: "Fable Gateway",
        reasoning_efforts: [],
        default_effort: null,
      },
    ]);
    const onSelect = vi.fn();
    render(<ModelMenu onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "FABLE" } });

    const row = await screen.findByTitle("openai/model-700");
    expect(row.textContent).toContain("Fable Gateway");
    expect(row.querySelector(".model-menu-hit")?.textContent).toBe("Fable");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("openai/model-700");
  });

  it("selects the active row with Enter", async () => {
    const onSelect = vi.fn();
    render(<ModelMenu onSelect={onSelect} />);
    const search = screen.getByLabelText("Search a model…");
    fireEvent.change(search, { target: { value: "sonnet" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
  });

  it("moves the active row with arrow keys before committing", async () => {
    const onSelect = vi.fn();
    render(<ModelMenu onSelect={onSelect} />);
    const search = screen.getByLabelText("Search a model…");
    fireEvent.change(search, { target: { value: "ai" } });
    await waitFor(() => {
      expect(screen.queryByText("Loading models…")).toBeNull();
    });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    const picked = onSelect.mock.calls[0]?.[0] as string;
    expect(typeof picked).toBe("string");
    expect(picked.length).toBeGreaterThan(0);
  });

  it("offers the exact ref when nothing matches", () => {
    const onSelect = vi.fn();
    render(<ModelMenu onSelect={onSelect} />);
    const search = screen.getByLabelText("Search a model…");
    fireEvent.change(search, { target: { value: "custom/weird-model" } });
    expect(screen.getByText("No matching models")).toBeTruthy();
    fireEvent.click(screen.getByText("Use “custom/weird-model”"));
    expect(onSelect).toHaveBeenCalledWith("custom/weird-model");
  });

  it("commits the exact ref via Enter when no catalog rows match", () => {
    const onSelect = vi.fn();
    render(<ModelMenu onSelect={onSelect} />);
    const search = screen.getByLabelText("Search a model…");
    fireEvent.change(search, { target: { value: "custom/weird-model" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("custom/weird-model");
  });

  it("renders the no-providers empty state", () => {
    providersStore.setState({ providers: {}, routes: [], routesLoaded: false });
    listProvidersMock.mockReturnValue(new Promise(() => undefined));
    render(<ModelMenu onSelect={() => undefined} />);
    expect(screen.getByText("No providers registered yet.")).toBeTruthy();
  });
});

describe("ModelMenu thinking section", () => {
  it("shows the supported reasoning range before the model catalog", () => {
    render(
      <ModelMenu
        onSelect={() => undefined}
        currentModel="openai/gpt-5"
        currentEffort={null}
        onSelectEffort={() => undefined}
      />,
    );
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByRole("slider").getAttribute("max")).toBe("1");
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("Low");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Change model/ }));
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    expect(screen.getByTitle("openai/gpt-5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Model settings/ }));
    expect(screen.getByRole("slider")).toBeTruthy();
  });

  it("hides the thinking section when the selected model has no efforts", () => {
    render(
      <ModelMenu
        onSelect={() => undefined}
        currentModel="anthropic/claude-sonnet-4"
        currentEffort={null}
        onSelectEffort={() => undefined}
      />,
    );
    expect(screen.queryByText("Thinking")).toBeNull();
  });

  it("marks the current effort row and offers the default row only when an effort is set", () => {
    render(
      <ModelMenu
        onSelect={() => undefined}
        currentModel="openai/gpt-5"
        currentEffort="high"
        onSelectEffort={() => undefined}
      />,
    );
    const current = screen.getByRole("slider");
    expect(current.getAttribute("aria-valuetext")).toBe("High");
    expect(screen.getByRole("button", { name: "Default" })).toBeTruthy();
  });

  it("hides the default row when no effort is set", () => {
    render(
      <ModelMenu
        onSelect={() => undefined}
        currentModel="openai/gpt-5"
        currentEffort={null}
        onSelectEffort={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();
  });

  it("selecting a level reports the raw effort", () => {
    const onSelectEffort = vi.fn();
    render(
      <ModelMenu
        onSelect={() => undefined}
        currentModel="openai/gpt-5"
        currentEffort={null}
        onSelectEffort={onSelectEffort}
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "1" } });
    expect(onSelectEffort).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(onSelectEffort).toHaveBeenCalledWith("high");
    expect(onSelectEffort).toHaveBeenCalledTimes(1);
  });

  it("selecting the default row reports null", () => {
    const onSelectEffort = vi.fn();
    render(
      <ModelMenu
        onSelect={() => undefined}
        currentModel="openai/gpt-5"
        currentEffort="high"
        onSelectEffort={onSelectEffort}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(onSelectEffort).toHaveBeenCalledWith(null);
  });

  it("orders supported standard levels by intensity and supports keyboard selection", () => {
    providersStore.getState().setCatalog("openai", [{ id: "gpt-5", reasoning_efforts: ["max", "high", "low"], default_effort: "low" }]);
    const onSelectEffort = vi.fn();
    render(<ModelMenu onSelect={() => undefined} currentModel="openai/gpt-5" currentEffort="low" onSelectEffort={onSelectEffort} />);
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("max")).toBe("2");
    fireEvent.change(slider, { target: { value: "2" } });
    fireEvent.keyUp(slider, { key: "End" });
    expect(onSelectEffort).toHaveBeenCalledWith("max");
  });

  it("keeps custom levels and handles a single available level", () => {
    providersStore.getState().setCatalog("openai", [{ id: "gpt-5", reasoning_efforts: ["adaptive"], default_effort: "adaptive" }]);
    render(<ModelMenu onSelect={() => undefined} currentModel="openai/gpt-5" onSelectEffort={() => undefined} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect(slider.getAttribute("aria-valuetext")).toBe("adaptive");
    expect(slider.value).toBe(slider.max);
    expect(slider.style.background).toContain("100%");
  });

  it("positions the sole max level on the right without writing an effort", () => {
    providersStore.getState().setCatalog("openai", [{ id: "gpt-5", reasoning_efforts: ["max"], default_effort: null }]);
    const onSelectEffort = vi.fn();
    render(<ModelMenu onSelect={() => undefined} currentModel="openai/gpt-5" onSelectEffort={onSelectEffort} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect(slider.value).toBe(slider.max);
    expect(slider.getAttribute("aria-valuetext")).toBe("Maximum");
    fireEvent.pointerUp(slider);
    expect(onSelectEffort).not.toHaveBeenCalled();
  });
});
