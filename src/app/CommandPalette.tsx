import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayFocus } from "./dialogFocus";
import { useTranslation } from "react-i18next";
import { useStore } from "./useStore";
import { navigate } from "./useHashRoute";
import { TOGGLE_PALETTE_EVENT, requestNewSession } from "./keyboard";
import { selectVisibleSessions, sessionsStore } from "@/stores/sessions";
import { SessionDot } from "@/features/sessions/SessionRow";
import "./command-palette.css";

const RECENT_SESSION_LIMIT = 8;

export interface PaletteAction {
  id: string;
  label: string;
  run: () => void;
  session?: { id: string };
  section?: { id: string; label: string; icon?: ReactNode };
  content?: ReactNode;
  searchText?: string;
  depth?: number;
  disabled?: boolean;
}

function fuzzyMatch(query: string, label: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  const haystack = label.toLowerCase();
  let index = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found < 0) {
      return false;
    }
    index = found + 1;
  }
  return true;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items?: PaletteAction[];
  title?: string;
  inputLabel?: string;
  placeholder?: string;
  emptyLabel?: string;
}

export function CommandPalette({
  open,
  onClose,
  items,
  title,
  inputLabel,
  placeholder,
  emptyLabel,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useOverlayFocus(panelRef, open, onClose);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const order = useStore(sessionsStore, (state) => state.order);

  const staticActions = useMemo<PaletteAction[]>(() => {
    return [
      {
        id: "new-session",
        label: t("core.palette.new_session"),
        run: () => {
          requestNewSession();
        },
      },
      {
        id: "nav-dashboard",
        label: t("core.route.dashboard"),
        run: () => {
          navigate({ name: "dashboard" });
        },
      },
      {
        id: "nav-providers",
        label: t("core.route.providers"),
        run: () => {
          navigate({ name: "providers" });
        },
      },
      {
        id: "nav-routes",
        label: t("core.route.routes"),
        run: () => {
          navigate({ name: "routes" });
        },
      },
      {
        id: "nav-settings",
        label: t("core.route.settings"),
        run: () => {
          navigate({ name: "settings" });
        },
      },
    ];
  }, [t]);

  const recentActions = useMemo<PaletteAction[]>(() => {
    return selectVisibleSessions({ sessions, order, filters: {} })
      .slice(0, RECENT_SESSION_LIMIT)
      .map((session) => ({
        id: `session:${session.id}`,
        label: session.title,
        run: () => {
          navigate({ name: "session", id: session.id });
        },
        session: { id: session.id },
        section: { id: "recent", label: t("core.palette.recent") },
      }));
  }, [sessions, order, t]);

  const actions = useMemo(() => {
    return (items ?? [...staticActions, ...recentActions]).filter((action) =>
      fuzzyMatch(query, action.searchText ?? action.label),
    );
  }, [items, staticActions, recentActions, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setCursor((current) => {
      if (actions[current] && !actions[current].disabled) return current;
      return Math.max(
        0,
        actions.findIndex((action) => !action.disabled),
      );
    });
  }, [actions]);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null || !open) {
      return;
    }
    panel.querySelector(".command-palette-item--active")?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, open, actions.length]);

  if (!open) {
    return null;
  }

  const closeAndRun = (action: PaletteAction): void => {
    if (action.disabled) return;
    onClose();
    action.run();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = actions.findIndex((action, index) => index > cursor && !action.disabled);
      if (next >= 0) setCursor(next);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      for (let index = cursor - 1; index >= 0; index--) {
        if (!actions[index]?.disabled) {
          setCursor(index);
          break;
        }
      }
      return;
    }
    if (event.key === "Enter") {
      const action = actions[cursor];
      if (action !== undefined) {
        event.preventDefault();
        closeAndRun(action);
      }
      return;
    }
  };

  return createPortal(
    <div
      className="command-palette-overlay"
      role="presentation"
      onClick={() => {
        onClose();
      }}
    >
      <div
        ref={panelRef}
        className="command-palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? t("core.palette.title")}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          aria-label={inputLabel ?? title ?? t("core.palette.title")}
          placeholder={placeholder ?? t("core.palette.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
        />
        {actions.length === 0 ? (
          <p className="command-palette-empty" role="status">
            {emptyLabel ?? t("core.palette.empty")}
          </p>
        ) : (
          <ul
            className="command-palette-list"
            role="listbox"
            aria-label={title ?? t("core.palette.title")}
          >
            {actions.map((action, index) => {
              const session = action.session ? sessions[action.session.id] : undefined;
              return (
                <li key={action.id}>
                  {action.section && action.section.id !== actions[index - 1]?.section?.id && (
                    <div className="command-palette-section" title={action.section.id}>
                      {action.section.icon}
                      {action.section.label}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-label={action.label}
                    aria-selected={index === cursor}
                    disabled={action.disabled}
                    className={`command-palette-item${index === cursor ? " command-palette-item--active" : ""}`}
                    style={
                      action.depth
                        ? { paddingLeft: 10 + Math.min(action.depth, 8) * 16 }
                        : undefined
                    }
                    onMouseEnter={() => {
                      if (!action.disabled) setCursor(index);
                    }}
                    onClick={() => closeAndRun(action)}
                  >
                    {action.content ?? <span>{action.label}</span>}
                    {session && <SessionDot session={session} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = (): void => {
      setOpen((value) => !value);
    };
    window.addEventListener(TOGGLE_PALETTE_EVENT, onToggle);
    return () => {
      window.removeEventListener(TOGGLE_PALETTE_EVENT, onToggle);
    };
  }, []);
  return <CommandPalette open={open} onClose={() => setOpen(false)} />;
}
