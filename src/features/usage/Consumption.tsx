import { Activity, Coins, Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UsageGroup, UsageOverview } from "@/daemon/rest/usage";
import { MetricsTable } from "./MetricsTable";
import { UsageChart } from "./UsageChart";
import { PriceSources } from "./PriceSources";
import { AnimatedUsageValue } from "./AnimatedUsageValue";
import { UsageInfo } from "./UsageInfo";
import { UsageQuality } from "./UsageQuality";
import { UsageSources } from "./UsageSources";
import { formatUsageUsdDetail } from "./format";

export function Consumption({
  data,
  group,
  displayedGroup = group,
  onGroupChange,
}: {
  data: UsageOverview;
  group: UsageGroup;
  displayedGroup?: UsageGroup;
  onGroupChange: (group: UsageGroup) => void;
}) {
  const { t, i18n } = useTranslation();
  const metrics = data.summary;
  const dollars =
    metrics.usd_equivalent !== null &&
    metrics.usd_equivalent.trim() !== "" &&
    Number.isFinite(Number(metrics.usd_equivalent))
      ? Number(metrics.usd_equivalent)
      : null;
  const bases = Object.entries(metrics.valuation_bases ?? {}).filter(
    ([basis, count]) => basis !== "unpriced" && count > 0,
  );
  const currentPricesOnly = bases.length === 1 && bases[0]?.[0] === "current_price_comparison";
  return (
    <>
      <div className="usage-cards">
        <article>
          <div className="usage-card-heading">
            <h2>
              <Coins size={15} aria-hidden="true" />
              {t(currentPricesOnly ? "usage.current_usd" : "usage.usd")}
            </h2>
            <UsageInfo label={t("usage.cost_info_title")}>
              <p>{t("usage.cost_info")}</p>
              {dollars !== null && (
                <p>
                  {t("usage.precise_value", {
                    value: formatUsageUsdDetail(metrics.usd_equivalent, i18n.language),
                  })}
                </p>
              )}
              {bases.length > 0 && (
                <p>
                  {bases
                    .map(([basis]) =>
                      t(`usage.valuation_bases.${basis}`, {
                        defaultValue: basis.replaceAll("_", " "),
                      }),
                    )
                    .join(" · ")}
                </p>
              )}
            </UsageInfo>
          </div>
          <AnimatedUsageValue value={dollars} currency locale={i18n.language} />
        </article>
        <UsageSources data={data} />
        <article>
          <h2>
            <Hash size={15} aria-hidden="true" />
            {t("usage.tokens")}
          </h2>
          <div className="usage-token-metrics">
            {(["input_tokens", "cache_read_tokens", "output_tokens"] as const).map((field) => (
              <div key={field}>
                <span>{t(`usage.token_labels.${field}`)}</span>
                <AnimatedUsageValue value={metrics[field]} compact locale={i18n.language} />
              </div>
            ))}
          </div>
        </article>
        <article>
          <div className="usage-card-heading">
            <h2>
              <Activity size={15} aria-hidden="true" />
              {t("usage.requests")}
            </h2>
            <UsageInfo label={t("usage.requests")}>
              <p>{t("usage.requests_note")}</p>
            </UsageInfo>
          </div>
          <AnimatedUsageValue value={metrics.request_count} locale={i18n.language} />
        </article>
      </div>
      <UsageQuality data={data} />
      <UsageChart data={data} />
      <section className="usage-section" aria-labelledby="usage-breakdown-title">
        <div className="usage-heading usage-section-heading">
          <div className="usage-heading-label">
            <h2 id="usage-breakdown-title">{t("usage.breakdown")}</h2>
            <UsageInfo label={t("usage.price_sources")} align="start">
              <PriceSources data={data} />
            </UsageInfo>
          </div>
          <label className="usage-inline-label">
            {t("usage.group_by")}
            <select
              value={group}
              onChange={(event) => onGroupChange(event.target.value as UsageGroup)}
            >
              {(["model", "session", "project"] as const).map((key) => (
                <option key={key} value={key}>
                  {t(`usage.${key}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <MetricsTable
          caption={t(`usage.${displayedGroup}`)}
          rows={data.breakdown}
          group={displayedGroup}
        />
        {data.breakdown_total > data.breakdown.length && (
          <p className="usage-note">
            {t("usage.truncated", { shown: data.breakdown.length, total: data.breakdown_total })}
          </p>
        )}
      </section>
      {(data.undated.fact_count > 0 || data.unallocated.fact_count > 0) && (
        <details className="usage-disclosure">
          <summary>{t("usage.time_gaps")}</summary>
          <p className="usage-note">{t("usage.time_gaps_note")}</p>
          <MetricsTable
            caption={t("usage.time_gaps")}
            rows={[
              { ...data.undated, key: t("usage.undated") },
              { ...data.unallocated, key: t("usage.unallocated") },
            ]}
          />
        </details>
      )}
    </>
  );
}
