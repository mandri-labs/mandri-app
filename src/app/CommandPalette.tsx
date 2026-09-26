import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
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
      }));
  }, [sessions, order]);

  const actions = useMemo(() => {
    return [...staticActions, ...recentActions].filter((action) =>
      fuzzyMatch(query, action.label),
    );
  }, [staticActions, recentActions, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    setCursor((current) => (actions.length === 0 ? 0 : Math.min(current, actions.length - 1)));
  }, [actions.length]);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null || !open) {
      return;
    }
    panel
      .querySelector(".command-palette-item--active")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, actions.length]);

  if (!open) {
    return null;
  }

  const closeAndRun = (action: PaletteAction): void => {
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
      setCursor((current) => Math.min(current + 1, actions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
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
    if (event.key === "Tab") {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const focusables = panel.querySelectorAll<HTMLElement>("input, button");
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
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
        aria-label={t("core.palette.title")}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          aria-label={t("core.palette.title")}
          placeholder={t("core.palette.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
        />
        {actions.length === 0 ? (
          <p className="command-palette-empty">{t("core.palette.empty")}</p>
        ) : (
          <ul className="command-palette-list" role="listbox" aria-label={t("core.palette.title")}>
            {staticActions
              .filter((action) => fuzzyMatch(query, action.label))
              .map((action) => {
                const index = actions.indexOf(action);
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === cursor}
                      className={`command-palette-item${index === cursor ? " command-palette-item--active" : ""}`}
                      onMouseEnter={() => {
                        setCursor(index);
                      }}
                      onClick={() => {
                        closeAndRun(action);
                      }}
                    >
                      <span>{action.label}</span>
                    </button>
                  </li>
                );
              })}
            {recentActions.some((action) => fuzzyMatch(query, action.label)) ? (
              <li className="command-palette-section" aria-hidden="true">
                {t("core.palette.recent")}
              </li>
            ) : null}
            {recentActions
              .filter((action) => fuzzyMatch(query, action.label))
              .map((action) => {
                const index = actions.indexOf(action);
                const session = sessions[action.session?.id ?? ""];
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === cursor}
                      className={`command-palette-item${index === cursor ? " command-palette-item--active" : ""}`}
                      onMouseEnter={() => {
                        setCursor(index);
                      }}
                      onClick={() => {
                        closeAndRun(action);
                      }}
                    >
                      <span>{action.label}</span>
                      {session === undefined ? null : <SessionDot session={session} />}
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
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
