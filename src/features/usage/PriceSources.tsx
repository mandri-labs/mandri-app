import { useTranslation } from "react-i18next";
import type { UsageOverview } from "@/daemon/rest/usage";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && value >= 0 && Number.isFinite(new Date(value).getTime())
    ? value
    : null;
}

function sourceLabel(source: string): string {
  try {
    return new URL(source).hostname || source;
  } catch {
    return source;
  }
}

export function PriceSources({ data }: { data: UsageOverview }) {
  const { t, i18n } = useTranslation();
  const sources = Object.entries(data.catalog ?? {}).flatMap(([catalog, value]) =>
    Object.entries(record(record(value)?.sources) ?? {}).flatMap(([source, raw]) => {
      const metadata = record(raw);
      return metadata ? [{ key: `${catalog}:${source}`, source, metadata }] : [];
    }),
  );
  return (
    <section className="usage-price-sources" aria-labelledby="usage-price-sources-title">
      <h2 id="usage-price-sources-title">{t("usage.price_sources")}</h2>
      {sources.length === 0 ? (
        <p className="usage-note">{t("usage.price_freshness_unknown")}</p>
      ) : (
        <ul>
          {sources.map(({ key, source, metadata }) => {
            const reviewed = timestamp(metadata.checked_at) ?? timestamp(metadata.reviewed_at);
            const retry = timestamp(metadata.retry_at);
            const status =
              reviewed === null
                ? "unavailable"
                : metadata.error != null || metadata.stale === true
                  ? "stale"
                  : retry !== null && retry <= data.as_of
                    ? "due"
                    : "available";
            return (
              <li key={key}>
                <span className="usage-price-source-name" title={source}>
                  {sourceLabel(source)}
                </span>
                <span
                  className={`usage-badge${status !== "available" ? " usage-badge--warning" : ""}`}
                >
                  {t(`usage.price_states.${status}`)}
                </span>
                <span className="usage-note">
                  {reviewed === null
                    ? t("usage.price_never_reviewed")
                    : t("usage.price_reviewed", {
                        date: new Date(reviewed).toLocaleString(i18n.language),
                      })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
