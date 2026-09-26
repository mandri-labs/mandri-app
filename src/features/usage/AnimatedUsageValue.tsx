import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatUsageNumber, formatUsageUsdHeadline } from "./format";

export function AnimatedUsageValue({
  value,
  currency = false,
  compact = false,
  locale,
}: {
  value: number | null;
  currency?: boolean;
  compact?: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const [displayed, setDisplayed] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      current.current = value;
      setDisplayed(value);
    };
    if (
      value === null ||
      current.current === null ||
      current.current === value ||
      motion?.matches
    ) {
      finish();
    } else {
      const from = current.current;
      const started = performance.now();
      const animate = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - started) / 350));
        current.current = from + (value - from) * (1 - (1 - progress) ** 3);
        setDisplayed(current.current);
        if (progress < 1) frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }
    const changed = () => {
      if (motion?.matches) finish();
    };
    motion?.addEventListener("change", changed);
    return () => {
      cancelAnimationFrame(frame);
      motion?.removeEventListener("change", changed);
    };
  }, [value]);
  const format = (number: number | null) =>
    currency
      ? formatUsageUsdHeadline(number === null ? null : String(number), locale)
      : compact && number !== null
        ? new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
            Math.round(number),
          )
        : formatUsageNumber(number === null ? null : Math.round(number), locale);
  const label =
    value === null
      ? t("usage.missing_hint")
      : currency
        ? format(value)
        : formatUsageNumber(value, locale);
  return (
    <strong aria-label={label} title={label} tabIndex={value === null || compact ? 0 : undefined}>
      {format(displayed)}
    </strong>
  );
}
