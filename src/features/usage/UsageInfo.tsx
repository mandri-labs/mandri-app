import { useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { ChipPopover } from "@/features/transcript/ChipPopover";

/** Shared anchored overlay supports keyboard, touch, Escape and outside click. */
export function UsageInfo({
  label,
  children,
  align = "end",
}: {
  label: string;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span className="usage-info" ref={anchor}>
      <button
        type="button"
        className="usage-info-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Info size={15} aria-hidden="true" />
      </button>
      {open && (
        <ChipPopover
          anchorRef={anchor}
          onClose={() => setOpen(false)}
          placement="bottom"
          align={align}
          className="usage-info-panel"
        >
          {children}
        </ChipPopover>
      )}
    </span>
  );
}
