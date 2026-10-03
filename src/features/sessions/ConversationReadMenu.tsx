import { CheckCheck, MoreVertical } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { useOverlayFocus } from "@/app/dialogFocus";
import { isUnread, type ConversationTarget } from "@/daemon/types/conversationStatus";
import { conversationStatusStore } from "@/stores/conversationStatus";
import { readConversation } from "./readConversation";
import "./lifecycle.css";

export function ConversationReadItem({ target, disabled, run }: {
  target: ConversationTarget;
  disabled?: boolean;
  run: (action: () => Promise<void>) => void;
}) {
  const { t } = useTranslation();
  const status = useStore(conversationStatusStore, (state) => state.statuses[target]);
  return <button type="button" role="menuitem" className="lifecycle-item"
    disabled={disabled || !isUnread(status)}
    onClick={() => {
      if (status?.completion_key) run(() => readConversation(target, status.completion_revision, status.completion_key!));
    }}>
    <CheckCheck size={14} aria-hidden="true" />
    {t("core.status.mark_read")}
  </button>;
}

export function ConversationReadMenu({ target }: { target: ConversationTarget }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useOverlayFocus(menu, open, () => setOpen(false));
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const element = menu.current!;
      element.style.left = `${Math.max(8, Math.min(rect.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - element.offsetHeight - 8))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, error]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    void action().then(() => setOpen(false)).catch(() => setError(true)).finally(() => setBusy(false));
  };
  return <div className="lifecycle-menu">
    <button ref={trigger} type="button" className="lifecycle-trigger"
      aria-label={t("core.lifecycle.menu")} aria-haspopup="menu" aria-expanded={open}
      onClick={() => { setError(false); setOpen((value) => !value); }}>
      <MoreVertical size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} className="lifecycle-popover" role="menu">
      <ConversationReadItem target={target} disabled={busy} run={run} />
      {error && <p role="alert">{t("core.status.read_error")}</p>}
    </div>, document.body)}
  </div>;
}
