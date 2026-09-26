import { ChartNoAxesCombined } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UsageOverview } from "@/daemon/rest/usage";
import { UsageInfo } from "./UsageInfo";
import { formatUsageUsd, formatUsageUsdDetail } from "./format";

export function UsageSources({ data }: { data: UsageOverview }) {
  const { t, i18n } = useTranslation();
  const sources = data.source_breakdown;
  const keys = ["gateway", "codex", "claude", "agy"];
  if (sources?.other && sources.other.fact_count > 0) keys.push("other");
  return (
    <article className="usage-sources" aria-labelledby="usage-sources-title">
      <div className="usage-card-heading">
        <h2 id="usage-sources-title">
          <ChartNoAxesCombined size={15} aria-hidden="true" />
          {t("usage.sources_title")}
        </h2>
        <UsageInfo label={t("usage.sources_title")}>
          <p>{t("usage.sources_note")}</p>
        </UsageInfo>
      </div>
      <dl>
        {keys.map((key) => {
          const metrics = sources?.[key];
          const amount = metrics?.fact_count === 0 ? "0" : metrics?.usd_equivalent;
          return (
            <div key={key}>
              <dt>{t(`usage.sources.${key}`)}</dt>
              <dd
                tabIndex={0}
                title={
                  amount == null
                    ? t("usage.missing_hint")
                    : `${formatUsageUsdDetail(amount, i18n.language)}${
                        metrics?.unpriced_fact_count ? ` · ${t("usage.known_subtotal")}` : ""
                      }`
                }
              >
                {formatUsageUsd(amount, i18n.language)}
                {metrics && metrics.unpriced_fact_count > 0 && amount != null && (
                  <span className="usage-source-partial" aria-label={t("usage.known_subtotal")}>
                    *
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}
