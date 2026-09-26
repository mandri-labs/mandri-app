import { useTranslation } from "react-i18next";
import type { UsageAccount } from "@/daemon/rest/usage";
import { UsageInfo } from "./UsageInfo";
import { accountTitle, accountWindowLabel } from "./accountFormat";
import { formatUsageUsd } from "./format";

export function AccountCard({ account }: { account: UsageAccount }) {
  const { t, i18n } = useTranslation();
  return (
    <article className="usage-account">
      <div className="usage-heading">
        <h2>{accountTitle(account)}</h2>
        <UsageInfo label={t("usage.account_info")}>
          <h2>{t("usage.account_info")}</h2>
          <p>{t("usage.account_id_note")}</p>
          <p className="usage-source">{account.account_id}</p>
        </UsageInfo>
      </div>
      <p className="usage-note">
        {t("usage.as_of", { date: new Date(account.observed_at).toLocaleString(i18n.language) })}
      </p>
      {(!account.windows || account.windows.length === 0) && <p>{t("usage.no_windows")}</p>}
      {account.windows?.map((window, index) => {
        const fraction =
          typeof window.remaining_fraction === "number" &&
          window.remaining_fraction >= 0 &&
          window.remaining_fraction <= 1
            ? window.remaining_fraction
            : null;
        const percent =
          typeof window.used_percent === "number" && Number.isFinite(window.used_percent)
            ? window.used_percent
            : fraction !== null
              ? Math.round((1 - fraction) * 10000) / 100
              : null;
        const label = accountWindowLabel(window, index, t);
        const reset =
          typeof window.resets_at === "number"
            ? window.resets_at
            : typeof window.reset_time === "string"
              ? Date.parse(window.reset_time)
              : null;
        return (
          <div className="usage-window" key={index}>
            <strong>{label}</strong>
            <span>
              {percent !== null ? t("usage.used", { value: percent }) : t("usage.unavailable")}
            </span>
            {percent !== null && percent >= 0 && percent <= 100 && (
              <progress max={100} value={percent} aria-label={label} />
            )}
            {window.status === "rejected" && <span>{t("usage.quota_reached")}</span>}
            <span>
              {reset !== null && Number.isFinite(reset)
                ? t("usage.resets", { date: new Date(reset).toLocaleString(i18n.language) })
                : t("usage.unknown_reset")}
            </span>
          </div>
        );
      })}
      {account.credits != null && (
        <p>
          {t("usage.credits")}: {account.credits}
        </p>
      )}
      {account.monthly_fee_usd != null && (
        <p>
          {t("usage.monthly_fee")}: {formatUsageUsd(account.monthly_fee_usd, i18n.language)}
        </p>
      )}
    </article>
  );
}
