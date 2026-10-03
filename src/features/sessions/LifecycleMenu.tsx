import { ConversationReadItem } from "./ConversationReadMenu";
import { BarChart3, MoreVertical, Pencil, Play, Trash2, LockOpen, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useOverlayFocus } from "@/app/dialogFocus";
import type { SessionView } from "@/stores/sessions";
import {
  deleteSessionAction,
  errorKey,
  renameSessionAction,
  resumeSessionAction,
  restoreNativeModelAction,
} from "./lifecycle";
import "./lifecycle.css";
import { applyAvailability, useSessionAvailability } from "./availability";
import { releaseSession } from "@/daemon/rest/availability";
import { sessionsStore } from "@/stores/sessions";
import { useStore } from "@/app/useStore";
import { permitsNative } from "@/daemon/protection";
import { agentsStore } from "@/stores/agents";
import { CreateAgentDialog } from "@/features/agents/CreateAgentDialog";
import { navigate } from "@/app/useHashRoute";

export interface LifecycleMenuProps {
  session: SessionView;
  className?: string;
}

type Overlay = "rename" | "delete" | "release" | "agent" | null;

export function LifecycleMenu({ session, className = "" }: LifecycleMenuProps) {
  const { t } = useTranslation();
  const canCreate = useStore(
    agentsStore,
    (state) => state.parentCapabilities[session.id]?.create ?? false,
  );
  const [open, setOpen] = useState(false);
  useSessionAvailability(session.id, open);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOverlayFocus(menuRef, open, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = rootRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const gap = 8;
      const above = Math.max(0, rect.top - gap * 2);
      const below = Math.max(0, window.innerHeight - rect.bottom - gap * 2);
      const top = below < menu.scrollHeight && above > below;
      menu.style.maxHeight = `${top ? above : below}px`;
      menu.style.left = `${Math.max(gap, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - gap))}px`;
      menu.style.top = `${Math.max(gap, top ? rect.top - menu.offsetHeight - gap : rect.bottom + gap)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (
        rootRef.current !== null &&
        !rootRef.current.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        setOverlay(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        if (overlay !== null) {
          setOverlay(null);
          return;
        }
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, overlay]);

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    void action()
      .then(() => {
        setOverlay(null);
        setOpen(false);
      })
      .catch((caught: unknown) => {
        setError(t(errorKey(caught)));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div ref={rootRef} className={`lifecycle-menu${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="lifecycle-trigger"
        aria-label={t("core.lifecycle.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("core.lifecycle.menu")}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
          setOverlay(null);
          setError(null);
        }}
      >
        <MoreVertical size={14} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div ref={menuRef} className="lifecycle-popover" role="menu">
          <ConversationReadItem target={`session:${session.id}`} disabled={busy} run={run} />
          {canCreate && (
            <button
              type="button"
              role="menuitem"
              className="lifecycle-item"
              disabled={busy}
              onClick={() => setOverlay("agent")}
            >
              {t("core.agents.create")}
            </button>
          )}
          {permitsNative(session) && session.availability?.owner !== "unowned" && (
            <button
              type="button"
              role="menuitem"
              className="lifecycle-item"
              disabled={busy || !session.availability?.can_release}
              title={
                session.availability?.reason
                  ? t(`core.availability.${session.availability.reason}`, {
                      defaultValue: t("core.availability.unavailable"),
                    })
                  : undefined
              }
              onClick={() => setOverlay("release")}
            >
              <LockOpen size={13} aria-hidden="true" />
              {t("core.lifecycle.release")}
            </button>
          )}
          {permitsNative(session) && session.availability?.can_restore && (
            <button
              type="button"
              role="menuitem"
              className="lifecycle-item"
              disabled={busy}
              onClick={() => run(() => restoreNativeModelAction(session.id))}
            >
              <RotateCcw size={13} aria-hidden="true" />
              {t("core.lifecycle.restore_native")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="lifecycle-item"
            disabled={busy}
            onClick={() => {
              setOverlay("rename");
              setError(null);
            }}
          >
            <Pencil size={13} aria-hidden="true" />
            <span>{t("core.lifecycle.rename")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="lifecycle-item lifecycle-item--danger"
            disabled={busy}
            onClick={() => {
              setOverlay("delete");
              setError(null);
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
            <span>{t("core.lifecycle.delete")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="lifecycle-item"
            onClick={() => {
              setOpen(false);
              navigate({ name: "usage", sessionId: session.id });
            }}
          >
            <BarChart3 size={13} aria-hidden="true" />
            <span>{t("usage.title")}</span>
          </button>
          {error !== null ? (
            <div className="lifecycle-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
      {overlay === "agent" && (
        <CreateAgentDialog
          sessionId={session.id}
          onClose={() => {
            setOverlay(null);
            setOpen(false);
          }}
        />
      )}
      {overlay === "rename" ? (
        <RenameOverlay
          session={session}
          busy={busy}
          error={error}
          onSubmit={(title) => run(() => renameSessionAction(session.id, title))}
          onClose={() => {
            setOverlay(null);
            setError(null);
          }}
        />
      ) : null}
      {overlay === "delete" ? (
        <DeleteOverlay
          busy={busy}
          error={error}
          hasWorktree={!!session.worktree && session.worktree.state !== "closed"}
          onConfirm={(purge, discard) => run(() => deleteSessionAction(session.id, purge, discard))}
          onClose={() => {
            setOverlay(null);
            setError(null);
          }}
        />
      ) : null}
      {overlay === "release" && (
        <ReleaseOverlay
          busy={busy}
          error={error}
          onClose={() => setOverlay(null)}
          onConfirm={() =>
            run(async () => {
              const availability = await releaseSession(session.id);
              applyAvailability(session.id, availability);
              if (availability.owner === "unowned")
                sessionsStore.getState().applySessionPatch(session.id, { state: "stopped" });
            })
          }
        />
      )}
    </div>
  );
}

function ReleaseOverlay({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  useOverlayFocus(panel, true, onClose);
  return (
    <div className="lifecycle-overlay" role="presentation" onClick={onClose}>
      <div
        ref={panel}
        className="lifecycle-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("core.lifecycle.release")}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="lifecycle-panel-title">{t("core.lifecycle.release")}</h2>
        <p>{t("core.lifecycle.release_confirmation")}</p>
        {error && (
          <p className="lifecycle-error" role="alert">
            {error}
          </p>
        )}
        <div className="lifecycle-panel-actions">
          <button type="button" className="lifecycle-button" onClick={onClose}>
            {t("core.actions.cancel")}
          </button>
          <button
            type="button"
            className="lifecycle-button lifecycle-button--primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {t("core.actions.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RenameOverlayProps {
  session: SessionView;
  busy: boolean;
  error: string | null;
  onSubmit: (title: string) => void;
  onClose: () => void;
}

function RenameOverlay({ session, busy, error, onSubmit, onClose }: RenameOverlayProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(session.title);
  const panelRef = useRef<HTMLFormElement>(null);
  useOverlayFocus(panelRef, true, onClose);
  return (
    <div className="lifecycle-overlay" role="presentation" onClick={onClose}>
      <form
        ref={panelRef}
        className="lifecycle-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("core.lifecycle.rename_title")}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <div className="lifecycle-panel-title">{t("core.lifecycle.rename_title")}</div>
        <input
          className="lifecycle-input"
          value={value}
          placeholder={t("core.lifecycle.rename_placeholder")}
          aria-label={t("core.lifecycle.rename_title")}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            }
          }}
        />
        {error !== null ? (
          <div className="lifecycle-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="lifecycle-panel-actions">
          <button type="button" className="lifecycle-button" onClick={onClose}>
            {t("core.actions.cancel")}
          </button>
          <button
            type="submit"
            className="lifecycle-button lifecycle-button--primary"
            disabled={busy || value.trim().length === 0}
          >
            {t("core.actions.rename")}
          </button>
        </div>
      </form>
    </div>
  );
}

interface DeleteOverlayProps {
  busy: boolean;
  error: string | null;
  onConfirm: (purge: boolean, discard: boolean) => void;
  hasWorktree: boolean;
  onClose: () => void;
}

function DeleteOverlay({ busy, error, onConfirm, onClose, hasWorktree }: DeleteOverlayProps) {
  const { t } = useTranslation();
  const [purge, setPurge] = useState(false);
  const [discard, setDiscard] = useState(false);
  const panelRef = useRef<HTMLFormElement>(null);
  useOverlayFocus(panelRef, true, onClose);
  return (
    <div className="lifecycle-overlay" role="presentation" onClick={onClose}>
      <form
        ref={panelRef}
        className="lifecycle-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("core.lifecycle.delete_title")}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(purge, discard);
        }}
      >
        <div className="lifecycle-panel-title">{t("core.lifecycle.delete_title")}</div>
        <p className="lifecycle-panel-body">{t("core.lifecycle.delete_body")}</p>
        <p className="lifecycle-panel-body">{t("usage.retention_note")}</p>
        {hasWorktree ? <>
          <p className="lifecycle-panel-body">{t("core.protection.worktree_cleanup")}</p>
          <label className="lifecycle-checkbox">
            <input type="checkbox" checked={discard} disabled={busy} onChange={(event) => setDiscard(event.target.checked)} />
            <span>{t("core.protection.worktree_discard")}</span>
          </label>
        </> : null}
        <label className="lifecycle-checkbox">
          <input
            type="checkbox"
            checked={purge}
            onChange={(event) => setPurge(event.target.checked)}
          />
          <span>{t("core.lifecycle.purge")}</span>
        </label>
        {error !== null ? (
          <div className="lifecycle-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="lifecycle-panel-actions">
          <button type="button" className="lifecycle-button" onClick={onClose}>
            {t("core.actions.cancel")}
          </button>
          <button
            type="submit"
            className="lifecycle-button lifecycle-button--danger"
            disabled={busy}
          >
            {t("core.lifecycle.delete")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SessionResumeAffordance({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="lifecycle-resume-affordance"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void resumeSessionAction(sessionId).finally(() => {
          setBusy(false);
        });
      }}
    >
      <Play size={12} aria-hidden="true" />
      <span>{t("core.keepalive.resume_after_close")}</span>
    </button>
  );
}

export function NeedsAttentionBadge({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  return (
    <span className="lifecycle-attention" role="status" data-session-id={sessionId}>
      <span className="lifecycle-attention-label">{t("core.attention.needs_attention")}</span>
    </span>
  );
}
