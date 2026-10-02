import type { TFunction } from "i18next";
import type { UsageAccount } from "@/daemon/rest/usage";

const plans: Record<string, Record<string, string>> = {
  codex: {
    free: "ChatGPT Free",
    go: "ChatGPT Go",
    plus: "ChatGPT Plus",
    pro: "ChatGPT Pro 20x",
    prolite: "ChatGPT Pro 5x",
    pro_20x: "ChatGPT Pro 20x",
    pro_5x: "ChatGPT Pro 5x",
    team: "ChatGPT Business",
    business: "ChatGPT Business",
    enterprise: "ChatGPT Enterprise",
    edu: "ChatGPT Edu",
    edu_plus: "ChatGPT Edu Plus",
    edu_pro: "ChatGPT Edu Pro",
  },
  claude: {
    free: "Claude Free",
    pro: "Claude Pro",
    max: "Claude Max",
    max_5x: "Claude Max 5x",
    max_20x: "Claude Max 20x",
    claude_max_5x: "Claude Max 5x",
    claude_max_20x: "Claude Max 20x",
    default_claude_max_5x: "Claude Max 5x",
    default_claude_max_20x: "Claude Max 20x",
    claude_pro: "Claude Pro",
    claude_max: "Claude Max",
    team: "Claude Team",
    enterprise: "Claude Enterprise",
  },
  agy: {
    free: "Antigravity Free",
    pro: "Google AI Pro",
    ultra: "Google AI Ultra",
    google_ai_pro: "Google AI Pro",
    google_ai_ultra: "Google AI Ultra",
  },
};

export function accountTitle(account: UsageAccount): string {
  const provider =
    { codex: "ChatGPT", claude: "Claude", agy: "Antigravity", opencode: "OpenCode", pi: "Pi" }[
      account.harness
    ] ?? account.harness;
  const plan = account.plan?.trim();
  if (!plan || plan.toLowerCase() === "unknown") return provider;
  const key = plan
    .toLowerCase()
    .replace(/\bx(\d+)\b/g, "$1x")
    .replace(/[\s-]+/g, "_");
  const known = plans[account.harness]?.[key];
  if (known) return known;
  if (/^(chatgpt|claude|google ai|antigravity|opencode|pi)\b/i.test(plan)) return plan;
  return `${provider} ${plan}`;
}

export function accountWindowLabel(
  window: Record<string, unknown>,
  index: number,
  t: TFunction,
): string {
  const label = typeof window.label === "string" ? window.label.trim() : "";
  const minutes = window.window_duration_minutes;
  let period: string | undefined;
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
    if (minutes === 10080) period = t("usage.quota_weekly");
    else if (minutes === 1440) period = t("usage.quota_daily");
    else if (minutes % 1440 === 0) period = t("usage.quota_days", { count: minutes / 1440 });
    else if (minutes % 60 === 0) period = t("usage.quota_hours", { count: minutes / 60 });
    else period = t("usage.quota_minutes", { count: minutes });
  }
  const bucket = typeof window.bucket_id === "string" ? window.bucket_id : "";
  if (!period && ["five_hour", "seven_day"].includes(bucket)) {
    period =
      bucket === "five_hour" ? t("usage.quota_hours", { count: 5 }) : t("usage.quota_weekly");
  }
  const scope =
    label ||
    (["", "codex", "default", "all", "five_hour", "seven_day"].includes(bucket)
      ? ""
      : bucket.replace(/[_-]+/g, " "));
  return scope && period
    ? `${scope} (${period})`
    : scope || period || t("usage.window", { count: index + 1 });
}
