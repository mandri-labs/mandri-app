import { ChevronDown } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

// Kept by Transcript across virtualized row unmounts.
export const DisclosureContext = createContext<Map<string, boolean> | null>(null);
export const DisclosureKeyContext = createContext<string>("");
export function Disclosure({
  title,
  expandedTitle,
  children,
  className = "",
}: {
  title: ReactNode;
  expandedTitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const cache = useContext(DisclosureContext);
  const key = useContext(DisclosureKeyContext);
  const [open, setOpen] = useState(() => cache?.get(key) ?? false);
  return (
    <div className={`tr-disclosure ${className}`}>
      <button
        type="button"
        className="tr-disclosure-toggle"
        aria-expanded={open}
        onClick={() => {
          cache?.set(key, !open);
          setOpen(!open);
        }}
      >
        {open ? (expandedTitle ?? title) : title}
        <ChevronDown size={12} aria-hidden="true" className={open ? "tr-tool-chevron-open" : ""} />
      </button>
      {open && <div className="tr-disclosure-content">{children}</div>}
    </div>
  );
}
