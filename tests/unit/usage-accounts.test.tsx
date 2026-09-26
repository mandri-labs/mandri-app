import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { UsageAccount } from "@/daemon/rest/usage";
import { AccountCard } from "@/features/usage/AccountCard";
import { accountTitle, accountWindowLabel } from "@/features/usage/accountFormat";
import i18n, { initI18n } from "@/i18n";

const account: UsageAccount = {
  account_id: "profile:codex:synthetic-profile-id",
  harness: "codex",
  plan: "pro",
  status: "stale",
  verified: false,
  auth_mode: null,
  observed_at: 1790243987354,
  credits: "0",
  windows: [
    {
      bucket_id: "codex",
      window: "primary",
      used_percent: 46,
      window_duration_minutes: 10080,
      resets_at: 1790419711000,
    },
  ],
};

beforeEach(async () => {
  await initI18n("fr");
});
afterEach(cleanup);

it.each([
  ["codex", "pro", "ChatGPT Pro 20x"],
  ["codex", "prolite", "ChatGPT Pro 5x"],
  ["codex", "plus", "ChatGPT Plus"],
  ["codex", "ChatGPT Pro 20x", "ChatGPT Pro 20x"],
  ["claude", "pro", "Claude Pro"],
  ["claude", "max", "Claude Max"],
  ["claude", "max x20", "Claude Max 20x"],
  ["claude", "max_5x", "Claude Max 5x"],
  ["claude", "default_claude_max_20x", "Claude Max 20x"],
  ["agy", "pro", "Google AI Pro"],
  ["agy", "ultra", "Google AI Ultra"],
  ["agy", "Google AI Ultra", "Google AI Ultra"],
  ["agy", null, "Antigravity"],
  ["opencode", null, "OpenCode"],
  ["pi", null, "Pi"],
  ["codex", "unknown", "ChatGPT"],
])("normalizes %s plan %s without inventing an absent tier", (harness, plan, title) => {
  expect(accountTitle({ ...account, harness, plan })).toBe(title);
});

it("shows a readable plan and weekly allowance with the identifier inside the info popover", () => {
  const { container } = render(<AccountCard account={account} />);
  expect(screen.getByRole("heading", { name: "ChatGPT Pro 20x" })).toBeTruthy();
  expect(
    screen.getByRole("progressbar", { name: "Quota hebdomadaire" }).getAttribute("value"),
  ).toBe("46");
  expect(screen.getByText("Crédits disponibles: 0")).toBeTruthy();
  expect(screen.getByText(/Instantané :/)).toBeTruthy();
  expect(screen.queryByText(account.account_id)).toBeNull();
  expect(container.textContent).not.toMatch(/authentification|vérifié|ancien|10080|primary/);
  const info = screen.getByRole("button", { name: "Informations du compte" });
  fireEvent.click(info);
  expect(screen.getByRole("dialog", { name: "Informations du compte" })).toBeTruthy();
  expect(screen.getByText(account.account_id)).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByText(account.account_id)).toBeNull();
});

it.each(["codex", "claude", "agy", "opencode"])(
  "removes technical account messages for %s",
  (harness) => {
    const { container } = render(<AccountCard account={{ ...account, harness, plan: null }} />);
    expect(container.querySelector(".usage-badge")).toBeNull();
    expect(container.textContent).not.toMatch(/authentification|vérifié|ancien|profile:/);
  },
);

it.each([
  [300, "Quota sur 5 h"],
  [1440, "Quota quotidien"],
  [10080, "Quota hebdomadaire"],
  [2880, "Quota sur 2 jours"],
  [15, "Quota sur 15 min"],
])("formats %i minutes as a meaningful period", (minutes, label) => {
  expect(
    accountWindowLabel(
      { bucket_id: "codex", window: "secondary", window_duration_minutes: minutes },
      0,
      i18n.t,
    ),
  ).toBe(label);
});

it("preserves separate model scopes and does not infer a period from primary or secondary", () => {
  expect(
    accountWindowLabel({ bucket_id: "sonnet", window_duration_minutes: 10080 }, 0, i18n.t),
  ).toBe("sonnet · Quota hebdomadaire");
  expect(accountWindowLabel({ bucket_id: "codex", window: "primary" }, 0, i18n.t)).toBe("Quota 1");
  expect(accountWindowLabel({ bucket_id: "five_hour" }, 0, i18n.t)).toBe("Quota sur 5 h");
});

it("shows the AGY subscription and separates five-hour and weekly group allowances", () => {
  render(
    <AccountCard
      account={{
        ...account,
        harness: "agy",
        plan: "Google AI Ultra",
        windows: [
          {
            label: "Gemini Models",
            bucket_id: "gemini-5h",
            window_duration_minutes: 300,
            remaining_fraction: 1,
          },
          {
            label: "Gemini Models",
            bucket_id: "gemini-weekly",
            window_duration_minutes: 10080,
            remaining_fraction: 0,
          },
        ],
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: "Google AI Ultra" })).toBeTruthy();
  expect(
    screen
      .getByRole("progressbar", { name: "Gemini Models · Quota sur 5 h" })
      .getAttribute("value"),
  ).toBe("0");
  expect(
    screen
      .getByRole("progressbar", { name: "Gemini Models · Quota hebdomadaire" })
      .getAttribute("value"),
  ).toBe("100");
});
