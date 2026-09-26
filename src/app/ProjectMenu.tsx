import { Folder, MessageCircle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { selectByProject, sessionsStore } from "@/stores/sessions";
import { lastSegment } from "@/features/sessions/SessionRow";
import { useStore } from "./useStore";
import { routeToHash } from "./useHashRoute";
import "./project-menu.css";

export function ProjectMenu({ path }: { path: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const order = useStore(sessionsStore, (state) => state.order);
  const filters = useStore(sessionsStore, (state) => state.filters);
  const members = useMemo(() => selectByProject({ sessions, order, filters }).find((group) => group.project === path)?.sessions ?? [], [sessions, order, filters, path]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="project-menu" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" className="project-menu-trigger" ref={trigger}
      aria-label={t("core.shell.project_info", { name: lastSegment(path) })}
      title={lastSegment(path)} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(!open)}><Folder size={16} aria-hidden="true" /></button>
    {open && <div id={id} className="project-menu-panel" role="region" aria-label={lastSegment(path)}>
      <div className="project-menu-line"><Folder size={16} aria-hidden="true" /><strong>{lastSegment(path)}</strong></div>
      <div className="project-menu-line project-menu-counts"><MessageCircle size={16} aria-hidden="true" /><span>
        {t("core.shell.project_tasks", { count: members.length })} · {t("core.shell.project_active", { count: members.filter((session) => session.activity === "active").length })}
      </span></div>
      <div className="project-menu-line project-menu-path"><Folder size={16} aria-hidden="true" /><span>{path}</span></div>
      <a className="project-menu-line" href={routeToHash({ name: "usage", projectPath: path })} onClick={() => setOpen(false)}>{t("usage.project_usage")}</a>
    </div>}
  </div>;
}
