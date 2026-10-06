import { CanvasLayout } from "@/features/canvas/CanvasLayout";
import { sidebarPreferencesStore } from "@/stores/sidebarPreferences";
import { isTemporaryPath } from "@/lib/temporaryPath";
import { LifecycleMenu } from "@/features/sessions/LifecycleMenu";
import {
  BarChart3,
  Bell,
  Folder,
  FolderOpen,
  GitBranch,
  LockKeyhole,
  Pencil,
  Search,
  Settings,
  SquarePen,
} from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { lastSegment, SessionDot } from "@/features/sessions/SessionRow";
import { AntigravityLogo, ClaudeLogo, OpenAILogo, OpencodeLogo, PiLogo } from "@/design/logos";
import {
  selectByProject,
  sessionWorkspace,
  sessionsStore,
  UNGROUPED_PROJECT,
} from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";
import { isSessionBusy } from "@/features/transcript/turnActivity";
import { navigate, routeTitleKey, routeToHash, withPaneWorkspace } from "./useHashRoute";
import type { Route } from "./useHashRoute";
import { NEW_SESSION_EVENT, requestFocusComposer, toggleCommandPalette } from "./keyboard";
import { EndpointMenu } from "./EndpointMenu";
import { useStore } from "./useStore";
import "./shell.css";
import { ProjectMenu } from "./ProjectMenu";
import { agentsStore } from "@/stores/agents";
import { AgentSidebar } from "@/features/agents/AgentSidebar";
import { ShellHeaderActionsContext } from "./ShellHeaderActions";
import { panesStore, paneKey } from "@/stores/panes";

export interface ShellProps {
  route: Route;
  children: ReactNode;
}

function openNewSession(): void {
  navigate({ name: "dashboard" });
  requestFocusComposer();
}

const SidebarSessionRow = memo(function SidebarSessionRow({
  session,
  active,
}: {
  session: SessionView;
  active: boolean;
}) {
  const { t } = useTranslation();
  const Logo = {
    claude: ClaudeLogo,
    codex: OpenAILogo,
    opencode: OpencodeLogo,
    agy: AntigravityLogo,
    pi: PiLogo,
  }[session.harness];
  const integratedWorktree = Boolean(session.worktree?.integrated_commit);
  const worktreeLabel = t(integratedWorktree ? "worktree.integrated" : "core.protection.worktree");
  return (
    <div className={`shell-session-container${active ? " shell-session-container--active" : ""}`}>
      <button
        type="button"
        className={`shell-session-row${active ? " shell-session-row--active" : ""}`}
        title={session.title}
        aria-current={active ? "page" : undefined}
        aria-label={`${session.title}${isSessionBusy(session) ? ` — ${t("core.transcript.agent_active")}` : ""}${session.pendingApprovals > 0 ? ` — ${t("core.sessions.approvals_badge", { count: session.pendingApprovals })}` : ""}${integratedWorktree ? `, ${worktreeLabel}` : ""}`}
        onClick={() => navigate({ name: "session", id: session.id })}
      >
        <span className="shell-session-icon-slot" aria-hidden="true">
          <Logo size={12} />
        </span>
        <span className="shell-session-title">{session.title}</span>
        <span className="shell-session-status-slot">
          {session.worktree ? (
            <span
              className={`shell-worktree-icon${integratedWorktree ? " shell-worktree-icon--integrated" : ""}`}
              title={
                integratedWorktree
                  ? `${session.worktree.id} (${worktreeLabel})`
                  : session.worktree.id
              }
            >
              <GitBranch size={12} aria-label={worktreeLabel} />
            </span>
          ) : null}
          {session.availability?.owner === "external" ? (
            <LockKeyhole size={12} aria-label={t("core.sessions.external_locked")} />
          ) : null}

          {session.pendingApprovals > 0 ? (
            <span className="shell-session-attention" aria-hidden="true">
              {session.pendingApprovals}
            </span>
          ) : (
            <SessionDot session={session} />
          )}
        </span>
      </button>
      <LifecycleMenu session={session} />
    </div>
  );
});

function ProjectsSection({
  route,
  activeSessionId,
}: {
  route: Route;
  activeSessionId: string | null;
}) {
  const { t } = useTranslation();
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const agents = useStore(agentsStore, (state) => state.agents);
  const loaded = useStore(agentsStore, (state) => state.loaded);
  const classifiedSessionIds = useStore(agentsStore, (state) => state.classifiedSessionIds);
  const classifiedSessions = useMemo(() => new Set(classifiedSessionIds), [classifiedSessionIds]);
  const agentRows = useMemo(() => Object.values(agents), [agents]);
  const linkedSessions = useMemo(
    () => new Set(agentRows.map((agent) => agent.session_id).filter(Boolean)),
    [agentRows],
  );
  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const order = useStore(sessionsStore, (state) => state.order);
  const filters = useStore(sessionsStore, (state) => state.filters);
  const hideTemporaryFolders = useStore(
    sidebarPreferencesStore,
    (state) => state.hideTemporaryFolders,
  );
  const groups = useMemo(
    () =>
      selectByProject({ sessions, order, filters }).filter(
        (group) => !hideTemporaryFolders || !isTemporaryPath(group.project),
      ),
    [sessions, order, filters, hideTemporaryFolders],
  );
  return (
    <>
      <div className="shell-section-label">{t("core.shell.projects")}</div>
      <div className="shell-projects">
        {groups.map((group) => {
          const roots = group.sessions.filter(
            (session) =>
              loaded && classifiedSessions.has(session.id) && !linkedSessions.has(session.id),
          );
          if (roots.length === 0 && loaded) return null;
          const visibleCount = visibleCounts[group.project] ?? 5;
          const isActive =
            activeSessionId !== null &&
            group.sessions.some((session) => session.id === activeSessionId);
          return (
            <div key={group.project} className="shell-project">
              <div className="shell-project-heading">
                <button
                  type="button"
                  className={`shell-project-row${isActive ? " shell-project-row--active" : ""}`}
                  title={group.project === UNGROUPED_PROJECT ? undefined : group.project}
                  aria-expanded={visibleCount > 0}
                  onClick={() =>
                    setVisibleCounts((counts) => ({
                      ...counts,
                      [group.project]: (counts[group.project] ?? 5) > 0 ? 0 : 5,
                    }))
                  }
                >
                  {isActive ? (
                    <FolderOpen size={16} aria-hidden="true" />
                  ) : (
                    <Folder size={16} aria-hidden="true" />
                  )}
                  <span className="shell-project-name">
                    {group.project === UNGROUPED_PROJECT
                      ? t("core.sessions.ungrouped")
                      : lastSegment(group.project)}
                  </span>
                </button>
                {group.project !== UNGROUPED_PROJECT && (
                  <button
                    type="button"
                    className="shell-icon-button shell-project-new"
                    title={t("core.shell.newChatInProject", {
                      project: lastSegment(group.project),
                    })}
                    aria-label={t("core.shell.newChatInProject", {
                      project: lastSegment(group.project),
                    })}
                    onClick={() => {
                      navigate({ name: "dashboard", cwd: group.project });
                      requestFocusComposer();
                    }}
                  >
                    <SquarePen size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {roots
                .filter((session, index) => index < visibleCount || session.id === activeSessionId)
                .map((session) => (
                  <Fragment key={session.id}>
                    <SidebarSessionRow
                      key={session.id}
                      session={session}
                      active={route.name === "session" && route.id === session.id}
                    />
                    {session.id === activeSessionId && (
                      <AgentSidebar
                        agents={agentRows.filter((agent) => agent.parent_session_id === session.id)}
                        activeId={route.name === "agent" ? route.id : undefined}
                      />
                    )}
                  </Fragment>
                ))}
              {visibleCount > 0 && !loaded && (
                <div className="shell-project-loading" role="status">
                  {t("core.shell.sessions_loading")}
                </div>
              )}
              {visibleCount > 0 && visibleCount < roots.length && (
                <button
                  type="button"
                  className="shell-project-more"
                  onClick={() =>
                    setVisibleCounts((counts) => ({
                      ...counts,
                      [group.project]: (counts[group.project] ?? 5) + 8,
                    }))
                  }
                >
                  {t("core.shell.show_more")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Breadcrumb({ route }: { route: Route }) {
  const { t } = useTranslation();
  const agent = useStore(agentsStore, (state) =>
    route.name === "agent" ? state.agents[route.id] : undefined,
  );
  const sessionId = route.name === "session" ? route.id : (agent?.parent_session_id ?? null);
  const session = useStore(sessionsStore, (state) =>
    sessionId === null ? undefined : state.sessions[sessionId],
  );
  const chevron = (key: string): ReactNode => (
    <span key={key} className="shell-breadcrumb-chevron" aria-hidden="true">
      ›
    </span>
  );
  let content: ReactNode;
  if (route.name === "dashboard") {
    content = (
      <>
        {chevron("lead")}
        <span className="shell-breadcrumb-segment">{t("core.shell.breadcrumb.dashboard")}</span>
      </>
    );
  } else if (route.name === "session" || (route.name === "agent" && sessionId !== null)) {
    const title = session?.title ?? sessionId;
    const projectPath = session ? sessionWorkspace(session) : undefined;
    content = (
      <>
        {projectPath !== undefined && <ProjectMenu key={sessionId} path={projectPath} />}
        {route.name === "agent" && sessionId !== null ? (
          <a
            className="shell-breadcrumb-segment shell-breadcrumb-link"
            href={routeToHash(withPaneWorkspace({ name: "session", id: sessionId }))}
          >
            {title}
          </a>
        ) : (
          <span className="shell-breadcrumb-segment">{title}</span>
        )}
        {route.name === "agent" && (
          <>
            {chevron("agent")}
            <span className="shell-breadcrumb-segment">
              {agent?.title ?? t("core.route.agent")}
            </span>
          </>
        )}
      </>
    );
  } else {
    content = (
      <>
        {chevron("lead")}
        <span className="shell-breadcrumb-segment">
          {route.name === "agent"
            ? (agent?.title ?? t("core.route.agent"))
            : t(routeTitleKey(route))}
        </span>
      </>
    );
  }
  return <nav className="shell-breadcrumb">{content}</nav>;
}

export function Shell({ route, children }: ShellProps) {
  const { t } = useTranslation();
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  const multiplePanes = useStore(panesStore, (state) => state.panes.length > 1);
  const hideHeader = multiplePanes && (route.name === "session" || route.name === "agent");
  const parentSessionId = useStore(agentsStore, (state) =>
    route.name === "agent" ? state.agents[route.id]?.parent_session_id : undefined,
  );
  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const order = useStore(sessionsStore, (state) => state.order);
  const pendingTarget = useMemo(() => {
    let target: SessionView | undefined;
    for (const id of order) {
      const session = sessions[id];
      if (session === undefined || session.deleted || session.pendingApprovals <= 0) {
        continue;
      }
      if (target === undefined || (session.lastActivityAt ?? 0) > (target.lastActivityAt ?? 0)) {
        target = session;
      }
    }
    return target;
  }, [sessions, order]);
  useEffect(() => {
    const onNewSession = (): void => {
      openNewSession();
    };
    window.addEventListener(NEW_SESSION_EVENT, onNewSession);
    return () => window.removeEventListener(NEW_SESSION_EVENT, onNewSession);
  }, []);
  return (
    <ShellHeaderActionsContext.Provider value={headerActions}>
      <div className={`shell${route.name === "usage" ? " shell--usage" : ""}`}>
        <aside className="shell-sidebar">
          <div className="shell-top">
            <button
              type="button"
              className="shell-brand"
              aria-label={t("core.app.title")}
              onClick={() => navigate({ name: "dashboard" })}
            >
              <span className="shell-brand-name" aria-hidden="true">
                Mandri
              </span>
            </button>
            <div className="shell-top-actions">
              <button
                type="button"
                className="shell-icon-button"
                aria-label={t("core.shell.search")}
                onClick={() => toggleCommandPalette()}
              >
                <Search size={16} aria-hidden="true" />
              </button>
              {pendingTarget !== undefined && (
                <button
                  type="button"
                  className="shell-icon-button"
                  aria-label={t("core.shell.notifications")}
                  onClick={() => {
                    if (pendingTarget !== undefined) {
                      navigate({ name: "session", id: pendingTarget.id });
                    }
                  }}
                >
                  <Bell size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <nav className="shell-nav">
            <button type="button" className="shell-row" onClick={openNewSession}>
              <Pencil size={16} aria-hidden="true" />
              <span>{t("core.shell.newChat")}</span>
            </button>
            <button
              type="button"
              className={`shell-row${route.name === "settings" ? " shell-row--active" : ""}`}
              onClick={() => navigate({ name: "settings" })}
            >
              <Settings size={16} aria-hidden="true" />
              <span>{t("core.route.settings")}</span>
            </button>
            <button
              type="button"
              className={`shell-row${route.name === "usage" ? " shell-row--active" : ""}`}
              aria-current={route.name === "usage" ? "page" : undefined}
              onClick={() => navigate({ name: "usage" })}
            >
              <BarChart3 size={16} aria-hidden="true" />
              <span>{t("usage.title")}</span>
            </button>
          </nav>
          <ProjectsSection
            route={route}
            activeSessionId={route.name === "session" ? route.id : (parentSessionId ?? null)}
          />
          <EndpointMenu />
        </aside>
        <CanvasLayout
          sessionId={
            route.name === "session" || route.name === "agent"
              ? paneKey({ kind: route.name, id: route.id })
              : undefined
          }
          showReopen={!hideHeader}
        >
          <div className="shell-main">
            {!hideHeader && (
              <header className="shell-header">
                <Breadcrumb route={route} />
                <div className="shell-header-actions" ref={setHeaderActions} />
              </header>
            )}
            <div className="shell-content">
              <div className="shell-content-scroll">{children}</div>
            </div>
          </div>
        </CanvasLayout>
      </div>
    </ShellHeaderActionsContext.Provider>
  );
}
