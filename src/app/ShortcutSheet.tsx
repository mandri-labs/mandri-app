import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverlayFocus } from "./dialogFocus";
import { TOGGLE_SHORTCUTS_EVENT, modifierKeyName } from "./keyboard";
import "./shortcut-sheet.css";

const PANE_COUNT = 4;

export interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const mod = modifierKeyName();
  useOverlayFocus(panelRef, open, onClose);

  const rows = useMemo<{ action: string; keys: string }[]>(() => {
    const list = [
      { action: t("core.shortcuts.command_palette"), keys: `${mod}+K` },
      { action: t("core.shortcuts.shortcut_sheet"), keys: `${mod}+/` },
      { action: t("core.shortcuts.new_session"), keys: `${mod}+N` },
      { action: t("core.shortcuts.close_pane"), keys: `${mod}+W` },
    ];
    for (let index = 0; index < PANE_COUNT; index += 1) {
      list.push({
        action: t("core.shortcuts.pane_focus", { n: index + 1 }),
        keys: `${mod}+${index + 1}`,
      });
    }
    return list;
  }, [t, mod]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="shortcut-sheet-overlay"
      role="presentation"
      onClick={() => {
        onClose();
      }}
    >
      <div
        ref={panelRef}
        className="shortcut-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("core.shortcuts.title")}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 className="shortcut-sheet-title">{t("core.shortcuts.title")}</h2>
        <table className="shortcut-sheet-table">
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.keys}:${row.action}`}>
                <td>{row.action}</td>
                <td>
                  <kbd className="shortcut-sheet-key">{row.keys}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ShortcutSheetHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = (): void => {
      setOpen((value) => !value);
    };
    window.addEventListener(TOGGLE_SHORTCUTS_EVENT, onToggle);
    return () => {
      window.removeEventListener(TOGGLE_SHORTCUTS_EVENT, onToggle);
    };
  }, []);
  return <ShortcutSheet open={open} onClose={() => setOpen(false)} />;
}
