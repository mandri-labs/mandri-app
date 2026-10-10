import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "@/app/useStore";
import { DaemonError } from "@/daemon/errors";
import {
  createProvider,
  listProviderModels,
  updateProvider,
  listProviders,
  deleteProvider,
  verifyProvider,
} from "@/daemon/rest/providers";
import { providersStore, type ProviderView } from "@/stores/providers";
import { getGatewayInfo } from "@/daemon/rest/gateway";
import { ProvidersPage } from "./ProvidersPage";
import { ModelCatalog } from "./ModelCatalog";
import { ProviderFormDialog } from "./ProviderForm";
import { initI18n } from "@/i18n";

vi.mock("@/daemon/rest/providers", () => ({
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  listProviderModels: vi.fn(),
  listProviders: vi.fn(),
  deleteProvider: vi.fn(),
  verifyProvider: vi.fn(),
}));

vi.mock("@/daemon/rest/gateway", () => ({ getGatewayInfo: vi.fn() }));

const provider: ProviderView = {
  name: "local",
  kind: "lm_studio",
  apiBase: "http://localhost:1234/v1",
  state: "verified",
  catalogState: "idle",
};

beforeAll(() => initI18n("en"));
beforeEach(() => {
  vi.clearAllMocks();
  providersStore.setState({ providers: { local: provider } });
  vi.mocked(listProviders).mockResolvedValue([
    {
      name: "local",
      kind: "lm_studio",
      state: "verified",
      api_base: provider.apiBase!,
      enabled: true,
    },
  ]);
  vi.mocked(getGatewayInfo).mockResolvedValue({
    providers: [
      {
        name: "local",
        kind: "lm_studio",
        state: "verified",
        api_base: provider.apiBase!,
        enabled: true,
      },
    ],
    routes: [],
  });
});
afterEach(cleanup);

function LiveCatalog() {
  const row = useStore(providersStore, (state) => state.providers.local!);
  return <ModelCatalog provider={row} defaultExpanded />;
}

describe("provider settings", () => {
  it("loads capabilities with the catalog and filters model names", async () => {
    vi.mocked(listProviderModels).mockResolvedValue([
      {
        id: "org/local",
        display_name: "Local Vision",
        reasoning_efforts: ["on"],
        default_effort: "on",
        image_input: true,
        tool_call: true,
      },
      { id: "other", reasoning_efforts: [], default_effort: null },
    ]);
    render(<LiveCatalog />);
    expect(await screen.findByText("Local Vision")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Image input" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Reasoning" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Tool calling" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Info" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vision" } });
    expect(screen.queryByText("other")).toBeNull();
  });

  it("reports a failed request and retries instead of showing an empty catalog", async () => {
    vi.mocked(listProviderModels)
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce([]);
    render(<LiveCatalog />);
    expect(
      await screen.findByText("The model list is unavailable for this provider."),
    ).toBeTruthy();
    expect(screen.queryByText("This provider exposes no models.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("This provider exposes no models.")).toBeTruthy();
    expect(listProviderModels).toHaveBeenCalledTimes(2);
  });

  it("selects OpenCode Go using the Mandri menu and submits a trimmed key", async () => {
    vi.mocked(createProvider).mockResolvedValue({
      name: "go",
      kind: "opencode_go",
      state: "verified",
      api_base: null,
    });
    render(<ProviderFormDialog open onSaved={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Kind" }));
    const option = screen.getByRole("menuitemradio", { name: "OpenCode (Go)" });
    option.focus();
    fireEvent.keyDown(option, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Ollama" }));
    fireEvent.click(option);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.change(screen.getByLabelText("API key (required)"), {
      target: { value: "  synthetic-key  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and verify" }));
    await waitFor(() =>
      expect(createProvider).toHaveBeenCalledWith({
        name: "go",
        kind: "opencode_go",
        api_base: null,
        api_key: "synthetic-key",
        verify: true,
      }),
    );
  });

  it("keeps the stored key when editing without a replacement", async () => {
    vi.mocked(updateProvider).mockResolvedValue({
      name: "local",
      kind: "lm_studio",
      state: "verified",
      api_base: provider.apiBase!,
    });
    render(
      <ProviderFormDialog
        open
        provider={provider}
        onSaved={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and verify" }));
    await waitFor(() =>
      expect(updateProvider).toHaveBeenCalledWith("local", { api_base: provider.apiBase }),
    );
    expect(providersStore.getState().providers.local?.catalogState).toBe("idle");
  });

  it("shows the provider rejection reason without closing the form", async () => {
    vi.mocked(updateProvider).mockRejectedValue(
      new DaemonError({
        code: "provider_verification_failed",
        message: "Verification failed",
        detail: { reason: "rate limited (status 429)" },
      }),
    );
    const onSaved = vi.fn();
    render(
      <ProviderFormDialog open provider={provider} onSaved={onSaved} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and verify" }));
    expect((await screen.findByRole("alert")).textContent).toContain("rate limited (status 429)");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("provider icon actions", () => {
  it("uses accessible icons and toggles enabled without replacing credentials", async () => {
    vi.mocked(updateProvider)
      .mockResolvedValueOnce({
        name: "local",
        kind: "lm_studio",
        state: "verified",
        api_base: provider.apiBase!,
        enabled: false,
      })
      .mockResolvedValueOnce({
        name: "local",
        kind: "lm_studio",
        state: "verified",
        api_base: provider.apiBase!,
        enabled: true,
      });
    const view = render(<ProvidersPage />);
    await waitFor(() => expect(listProviders).toHaveBeenCalled());
    const edit = screen.getByRole("button", { name: "Edit" });
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(edit.textContent).toBe("");
    expect(remove.textContent).toBe("");
    expect(remove.querySelector(".lucide-trash-2")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Disable" }));
    await screen.findByRole("switch", { name: "Enable" });
    expect(updateProvider).toHaveBeenLastCalledWith("local", { enabled: false });
    expect(providersStore.getState().providers.local?.enabled).toBe(false);
    expect(view.container.querySelector(".providers-status--disabled")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Enable" }));
    await screen.findByRole("switch", { name: "Disable" });
    expect(updateProvider).toHaveBeenLastCalledWith("local", { enabled: true });
  });

  it("keeps the provider enabled when the toggle request fails", async () => {
    vi.mocked(updateProvider).mockRejectedValue(
      new DaemonError({ code: "provider_invalid", message: "Rejected" }),
    );
    render(<ProvidersPage />);
    await waitFor(() => expect(listProviders).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("switch", { name: "Disable" }));
    await screen.findByRole("alert");
    expect(providersStore.getState().providers.local?.enabled).toBe(true);
    expect(screen.getByRole("switch", { name: "Disable" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("retains the delete confirmation before removing a provider", async () => {
    vi.mocked(deleteProvider).mockResolvedValue(undefined);
    render(<ProvidersPage />);
    await waitFor(() => expect(listProviders).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(deleteProvider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(providersStore.getState().providers.local).toBeUndefined());
    expect(deleteProvider).toHaveBeenCalledWith("local");
  });
});

it("checks provider health through the verification icon", async () => {
  vi.mocked(verifyProvider).mockResolvedValue({
    name: "local",
    kind: "lm_studio",
    state: "degraded",
    api_base: provider.apiBase!,
    enabled: true,
  });
  const view = render(<ProvidersPage />);
  await waitFor(() => expect(listProviders).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() => expect(providersStore.getState().providers.local?.state).toBe("degraded"));
  expect(verifyProvider).toHaveBeenCalledWith("local");
  expect(view.container.querySelector(".providers-status--warning")).toBeTruthy();
});
