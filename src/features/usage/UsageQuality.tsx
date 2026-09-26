import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UsageOverview } from "@/daemon/rest/usage";
import { formatUsageNumber } from "./format";

export function UsageQuality({ data }: { data: UsageOverview }) {
  const { t, i18n } = useTranslation();
  const metrics = data.summary;
  const counts = {
    incomplete: metrics.incomplete_fact_count,
    unpriced: metrics.unpriced_fact_count,
    unclassified: metrics.unclassified_fact_count ?? 0,
    discarded: data.sync_state?.discarded_event_count ?? 0,
    gaps: data.sync_state?.gap_count ?? 0,
  };
  const positive = (values: Record<string, number>) =>
    Object.entries(values).filter(([, n]) => n > 0);
  const partial =
    positive(counts).length > 0 ||
    positive(metrics.missing_fields).length > 0 ||
    data.sync_state?.status === "partial";
  if (!partial && metrics.fact_count > 0) return null;
  const sections = [
    {
      label: "unpriced_reasons_title",
      prefix: "unpriced_reasons",
      values: metrics.unpriced_reasons ?? {},
    },
    {
      label: "discard_reasons_title",
      prefix: "discard_reasons",
      values: data.sync_state?.discard_reasons ?? {},
    },
    { label: "missing_fields", prefix: "fields", values: metrics.missing_fields },
    { label: "history_status", prefix: "states", values: data.history_status ?? {} },
  ];
  return (
    <details className="usage-quality usage-notice">
      <summary>
        <TriangleAlert size={15} aria-hidden="true" />
        <span>
          {t(metrics.fact_count === 0 ? "usage.empty" : "usage.quality_summary")}
          {metrics.fact_count > 0 && positive(counts).length > 0 && (
            <span className="usage-quality-counts">
              {" "}
              ·{" "}
              {positive(counts)
                .map(([key, count]) => t(`usage.quality_counts.${key}`, { count }))
                .join(" · ")}
            </span>
          )}
        </span>
      </summary>
      <div className="usage-quality-details">
        <p>{t("usage.quality_note")}</p>
        {sections
          .filter(({ values }) => positive(values).length > 0)
          .map(({ label, prefix, values }) => (
            <section key={label}>
              <h3>{t(`usage.${label}`)}</h3>
              <dl>
                {positive(values).map(([key, count]) => (
                  <div key={key}>
                    <dt>
                      {t(`usage.${prefix}.${key}`, { defaultValue: key.replaceAll("_", " ") })}
                    </dt>
                    <dd>{formatUsageNumber(count, i18n.language)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </details>
  );
}
