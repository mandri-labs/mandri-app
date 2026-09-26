export function formatUsageNumber(value: number | null | undefined, locale: string): string {
  return value == null ? "—" : new Intl.NumberFormat(locale).format(value);
}

export function formatUsageUsd(value: string | null | undefined, locale: string): string {
  if (value == null || value.trim() === "" || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (number > 0 && number < 0.000001) return "< US$0.000001";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(number);
}

export function formatUsageUsdHeadline(value: string | null | undefined, locale: string): string {
  if (value == null || value.trim() === "" || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatUsageUsdAxis(value: number, locale: string): string {
  if (value > 0 && value < 0.01) return `< ${formatUsageUsdHeadline("0.01", locale)}`;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: value >= 1000 ? "compact" : "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  }).format(value);
}

export function formatUsageUsdDetail(value: string | null | undefined, locale: string): string {
  if (value != null && value.trim() !== "" && Number.isFinite(Number(value)) &&
    Math.round(Number(value) * 1_000_000) / 1_000_000 !== Number(value)) return `${value.trim()} USD`;
  return formatUsageUsd(value, locale);
}

export function formatUsageDate(date: string, locale: string): string {
  // API buckets are already calendar dates in the selected timezone.
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
