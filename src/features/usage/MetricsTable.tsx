import { useTranslation } from "react-i18next";
import { navigate } from "@/app/useHashRoute";
import type { UsageGroup, UsageMetrics } from "@/daemon/rest/usage";
import { formatUsageNumber, formatUsageUsd } from "./format";

export function MetricsTable({
  rows,
  caption,
  group,
}: {
  rows: Array<UsageMetrics & { key: string | null; deleted?: boolean }>;
  caption: string;
  group?: UsageGroup;
}) {
  const { t, i18n } = useTranslation();
  const value = (formatted: string) =>
    formatted === "—" ? (
      <span tabIndex={0} title={t("usage.missing_hint")} aria-label={t("usage.missing_hint")}>
        —
      </span>
    ) : (
      formatted
    );
  return (
    <div className="usage-table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="usage-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t(group ? `usage.${group}` : "usage.name")}</th>
            <th scope="col">{t("usage.requests")}</th>
            <th scope="col">{t("usage.fields.input_tokens")}</th>
            <th scope="col">{t("usage.fields.cache_read_tokens")}</th>
            <th scope="col">{t("usage.fields.output_tokens")}</th>
            <th scope="col">{t("usage.tokens")}</th>
            <th scope="col">{t("usage.usd")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.key}-${index}`}>
              <th scope="row">
                {row.key !== null && (group === "project" || group === "session") ? (
                  <button
                    className="usage-link"
                    type="button"
                    onClick={() =>
                      navigate(
                        group === "session"
                          ? { name: "usage", sessionId: row.key! }
                          : { name: "usage", projectPath: row.key! },
                      )
                    }
                  >
                    {row.key}
                  </button>
                ) : (
                  (row.key ??
                  t(group === "model" ? "usage.unclassified_model" : "usage.unattributed"))
                )}
                {row.deleted && (
                  <span className="usage-row-detail">{t("usage.deleted_session")}</span>
                )}
                {(row.incomplete_fact_count > 0 ||
                  row.unpriced_fact_count > 0 ||
                  (row.unclassified_fact_count ?? 0) > 0) && (
                  <span className="usage-row-detail usage-warning-text">
                    {Object.entries({
                      incomplete: row.incomplete_fact_count,
                      unpriced: row.unpriced_fact_count,
                      unclassified: row.unclassified_fact_count ?? 0,
                    })
                      .filter(([, count]) => count > 0)
                      .map(([key, count]) => t(`usage.quality_counts.${key}`, { count }))
                      .join(", ")}
                  </span>
                )}
              </th>
              <td>{value(formatUsageNumber(row.request_count, i18n.language))}</td>
              <td>{value(formatUsageNumber(row.input_tokens, i18n.language))}</td>
              <td>{value(formatUsageNumber(row.cache_read_tokens, i18n.language))}</td>
              <td>{value(formatUsageNumber(row.output_tokens, i18n.language))}</td>
              <td>{value(formatUsageNumber(row.total_tokens, i18n.language))}</td>
              <td className="usage-table-cost">
                {value(formatUsageUsd(row.usd_equivalent, i18n.language))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="usage-empty-inline">{t("usage.no_groups")}</p>}
    </div>
  );
}
