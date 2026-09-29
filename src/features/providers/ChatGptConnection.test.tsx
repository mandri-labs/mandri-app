import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { cancelChatGptLogin, getChatGptLogin, startChatGptLogin, submitChatGptRedirect } from "@/daemon/rest/chatgpt";
import { listProviders } from "@/daemon/rest/providers";
import { openAuthorizationUrl } from "@/lib/platform/externalUrl";
import { providersStore } from "@/stores/providers";
import { ProviderFormDialog } from "./ProviderForm";

vi.mock("@/daemon/rest/chatgpt", () => ({ startChatGptLogin: vi.fn(), getChatGptLogin: vi.fn(), submitChatGptRedirect: vi.fn(), cancelChatGptLogin: vi.fn() }));
vi.mock("@/daemon/rest/providers", () => ({ createProvider: vi.fn(), updateProvider: vi.fn(), listProviders: vi.fn() }));
vi.mock("@/lib/platform/externalUrl", () => ({ openAuthorizationUrl: vi.fn() }));
const pending = { login_id: "test-login", provider_name: "work", status: "pending", authorize_url: "https://auth.openai.com/oauth/authorize?state=synthetic" };

beforeAll(() => initI18n("en"));
beforeEach(() => {
  vi.clearAllMocks();
  providersStore.setState({ providers: {} });
  vi.mocked(startChatGptLogin).mockResolvedValue(pending);
  vi.mocked(getChatGptLogin).mockResolvedValue(pending);
  vi.mocked(cancelChatGptLogin).mockResolvedValue({ ...pending, status: "cancelled" });
  vi.mocked(openAuthorizationUrl).mockResolvedValue();
});
afterEach(cleanup);

async function begin(onClose = vi.fn(), onSaved = vi.fn()) {
  render(<ProviderFormDialog open onClose={onClose} onSaved={onSaved} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "work" } });
  fireEvent.click(screen.getByRole("button", { name: "Kind" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "ChatGPT (subscription)" }));
  expect(screen.queryByLabelText("API key (required)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT" }));
  await screen.findByRole("button", { name: "Open ChatGPT" });
}

describe("ChatGPT account connection", () => {
  it("starts without an API key, opens the browser and cancels on close", async () => {
    const close = vi.fn();
    await begin(close);
    expect(startChatGptLogin).toHaveBeenCalledWith("work", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Open ChatGPT" }));
    await waitFor(() => expect(openAuthorizationUrl).toHaveBeenCalledWith(pending.authorize_url));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelChatGptLogin).toHaveBeenCalledWith("test-login");
    expect(close).toHaveBeenCalledOnce();
  });

  it("accepts a manual redirect then refreshes providers before completion", async () => {
    const saved = vi.fn();
    vi.mocked(submitChatGptRedirect).mockResolvedValue({ ...pending, status: "completed" });
    vi.mocked(listProviders).mockResolvedValue([{ name: "work", kind: "chatgpt", state: "verified", api_base: null }]);
    await begin(vi.fn(), saved);
    fireEvent.click(screen.getByText("Signing in from another machine?"));
    fireEvent.change(screen.getByLabelText("Redirect URL"), { target: { value: "http://localhost:1455/auth/callback?code=synthetic&state=test" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete connection" }));
    await screen.findByText("Your account is connected");
    await waitFor(() => expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(false));
    expect(providersStore.getState().providers.work?.state).toBe("verified");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(saved).toHaveBeenCalledOnce();
    expect(cancelChatGptLogin).not.toHaveBeenCalled();
  });

  it("polls the callback and offers a new login when the session expires", async () => {
    vi.mocked(getChatGptLogin).mockResolvedValue({ ...pending, status: "failed", error_code: "chatgpt_login_timeout" });
    await begin();
    await screen.findByText("This sign-in link has expired. Start again to get a new link.", {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(startChatGptLogin).toHaveBeenCalledTimes(2));
  });

  it("reconnects an existing account without editing its name or requesting a key", async () => {
    const provider = { name: "work", kind: "chatgpt", state: "pending_auth" as const, catalogState: "idle" as const };
    providersStore.setState({ providers: { work: provider } });
    render(<ProviderFormDialog open provider={provider} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect account" }));
    await screen.findByRole("button", { name: "Open ChatGPT" });
    expect(startChatGptLogin).toHaveBeenCalledWith("work", undefined);
  });
});
