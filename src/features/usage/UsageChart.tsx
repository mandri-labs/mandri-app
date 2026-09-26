import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { UsageOverview } from "@/daemon/rest/usage";
import { MetricsTable } from "./MetricsTable";
import {
  formatUsageDate,
  formatUsageNumber,
  formatUsageUsdDetail,
  formatUsageUsdAxis,
} from "./format";

type Metric = "usd_equivalent" | "total_tokens";
const DAY = 86_400_000;

export function UsageChart({ data }: { data: UsageOverview }) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<Metric>("usd_equivalent");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const rows = [...data.timeseries].sort((a, b) => a.date.localeCompare(b.date));
  const first = rows[0];
  const last = rows.at(-1);
  const start = first ? Date.parse(`${first.date}T00:00:00Z`) : 0;
  const end = last ? Date.parse(`${last.date}T00:00:00Z`) : start;
  const days = Math.round((end - start) / DAY) + 1;
  const known = rows.map((row) => row[metric]).filter((value) => value != null);
  const max = Math.max(0, ...known.map(Number));
  const selected = rows.find((row) => row.date === selectedDate);
  const formatValue = (value: string | number | null | undefined) =>
    metric === "usd_equivalent"
      ? formatUsageUsdDetail(value == null ? null : String(value), i18n.language)
      : formatUsageNumber(value == null ? null : Number(value), i18n.language);
  const axisValue = (value: number) =>
    metric === "total_tokens"
      ? new Intl.NumberFormat(i18n.language, {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value)
      : formatUsageUsdAxis(value, i18n.language);
  const ticks = Array.from(new Set([0, Math.floor((days - 1) / 2), days - 1]));
  return (
    <section className="usage-section" aria-labelledby="usage-daily-title">
      <div className="usage-heading usage-section-heading">
        <div>
          <h2 id="usage-daily-title">{t("usage.daily")}</h2>
          <p className="usage-note" title={t("usage.chart_note", { timezone: data.timezone })}>
            {data.timezone}
          </p>
        </div>
        <div className="usage-segmented" role="group" aria-label={t("usage.metric")}>
          {(["usd_equivalent", "total_tokens"] as const).map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {t(key === "usd_equivalent" ? "usage.chart_usd" : "usage.tokens")}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="usage-chart-empty">
          <p>{t("usage.no_dated")}</p>
        </div>
      ) : (
        <div className="usage-chart-panel">
          <div className="usage-chart-readout" aria-live="polite">
            {selected ? (
              <>
                <span>{formatUsageDate(selected.date, i18n.language)}</span>
                <strong>{formatValue(selected[metric])}</strong>
              </>
            ) : (
              <span>{t("usage.chart_inspect")}</span>
            )}
          </div>
          <div className="usage-chart-layout">
            <div className="usage-chart-axis" aria-hidden="true">
              {[max, max / 2, 0].map((value, index) => (
                <span key={index}>{known.length > 0 ? axisValue(value) : "—"}</span>
              ))}
            </div>
            <div className="usage-chart" role="group" aria-label={t("usage.daily")}>
              <div className="usage-chart-grid" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              {rows.map((row, index) => {
                const value = row[metric];
                const offset = Math.round((Date.parse(`${row.date}T00:00:00Z`) - start) / DAY);
                return (
                  <button
                    type="button"
                    className={`usage-bar-slot${selectedDate === row.date ? " usage-bar-slot--selected" : ""}`}
                    key={row.date}
                    tabIndex={
                      selected ? (selected.date === row.date ? 0 : -1) : index === 0 ? 0 : -1
                    }
                    style={{
                      left: `${((offset + 0.5) / days) * 100}%`,
                      width: `${Math.min(100 / days, 12)}%`,
                    }}
                    aria-label={`${formatUsageDate(row.date, i18n.language)}: ${value == null ? t("usage.missing_hint") : formatValue(value)}`}
                    title={value == null ? t("usage.missing_hint") : undefined}
                    onFocus={() => setSelectedDate(row.date)}
                    onMouseEnter={() => setSelectedDate(row.date)}
                    onClick={() => setSelectedDate(row.date)}
                    onKeyDown={(event) => {
                      const buttons =
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                          "button",
                        );
                      if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        buttons?.[event.key === "Home" ? 0 : rows.length - 1]?.focus();
                        return;
                      }
                      const step =
                        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                      if (!step) return;
                      event.preventDefault();
                      buttons?.[Math.max(0, Math.min(rows.length - 1, index + step))]?.focus();
                    }}
                  >
                    {value == null ? (
                      <span className="usage-chart-gap" aria-hidden="true">
                        —
                      </span>
                    ) : (
                      <span
                        className={`usage-bar${Number(value) === 0 ? " usage-bar--zero" : ""}`}
                        aria-hidden="true"
                        style={{ height: max > 0 ? `${(Number(value) / max) * 100}%` : "0%" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="usage-chart-dates" aria-hidden="true">
              {ticks.map((offset) => (
                <span key={offset} style={{ left: `${((offset + 0.5) / days) * 100}%` }}>
                  {formatUsageDate(
                    new Date(start + offset * DAY).toISOString().slice(0, 10),
                    i18n.language,
                  )}
                </span>
              ))}
            </div>
          </div>
          <details className="usage-chart-table">
            <summary>{t("usage.table_alternative")}</summary>
            <MetricsTable
              caption={t("usage.daily")}
              rows={rows.map((row) => ({ ...row, key: row.date }))}
            />
          </details>
        </div>
      )}
    </section>
  );
}
