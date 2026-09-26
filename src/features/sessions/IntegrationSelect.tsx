import { useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ChipPopover } from "@/features/transcript/ChipPopover";
import "./permissions.css";

export function IntegrationSelect<T extends string>({
  label,
  value,
  placeholder,
  options,
  disabled,
  icon,
  onChange,
}: {
  label: string;
  value: T;
  placeholder?: string;
  options: { value: T; label: string; description?: string }[];
  disabled: boolean;
  icon: ReactNode;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="worktree-select-field">
      <span id={`${id}-label`}>{label}</span>
      <div ref={anchor}>
        <button
          type="button"
          className="worktree-select-trigger"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open && !disabled}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          {icon}
          <span>{selected?.label ?? placeholder}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open && !disabled ? (
          <ChipPopover
            anchorRef={anchor}
            placement="bottom"
            align="start"
            onClose={() => setOpen(false)}
          >
            <div
              className="permission-menu"
              role="menu"
              aria-labelledby={`${id}-label`}
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
                );
                const current = items.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                        items.length;
                items[next]?.focus();
              }}
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === option.value}
                  className="permission-option worktree-select-option"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>
                    <span className="permission-option-label">{option.label}</span>
                    {option.description ? (
                      <span className="permission-option-description">{option.description}</span>
                    ) : null}
                  </span>
                  <Check
                    size={16}
                    aria-hidden="true"
                    className={value === option.value ? "" : "permission-check--hidden"}
                  />
                </button>
              ))}
            </div>
          </ChipPopover>
        ) : null}
      </div>
    </div>
  );
}
