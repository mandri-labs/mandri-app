import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { navigate } from "@/app/useHashRoute";
import { useStore } from "@/app/useStore";
import { approvalsStore, selectApprovalCount } from "@/stores/approvals";
import { sessionWorkspace, type SessionView } from "@/stores/sessions";
import { policyChoice } from "@/daemon/protection";
import { ConversationIndicator } from "./ConversationIndicator";
import { LifecycleMenu } from "./LifecycleMenu";
import "./session-list.css";

export function lastSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  const last = parts.at(-1);
  return last ?? path;
}

export function SessionDot({ session }: { session: SessionView }) {
  return <ConversationIndicator target={`session:${session.id}`}
    fallback={session.nativeTurnActive || session.externalBusy ? "working" : undefined} />;
}

export interface SessionRowProps {
  session: SessionView;
  selected?: boolean;
  onSelect?: (sessionId: string) => void;
}

export function SessionRow({ session, selected = false, onSelect }: SessionRowProps) {
  const { t } = useTranslation();
  const approvalsCount = useStore(
    approvalsStore,
    useCallback((state) => selectApprovalCount(state, session.id), [session.id]),
  );
  const pendingApprovals = approvalsCount ?? session.pendingApprovals;
  const open = (): void => {
    if (onSelect !== undefined) {
      onSelect(session.id);
      return;
    }
    navigate({ name: "session", id: session.id });
  };
  return (
    <div className="session-row-line">
      <button
        type="button"
        className={`session-item${selected ? " session-item--active" : ""}`}
        onClick={open}
        title={session.title}
      >
        <span className="session-item-title">{session.title}</span>
        <span className="session-item-meta">
          {session.policyConfirmed && policyChoice(session) !== "standard" ? (
            <span className="session-badge">{t(`core.protection.${policyChoice(session)}`)}</span>
          ) : null}
          {session.model !== undefined ? (
            <span className="session-item-model">{session.model}</span>
          ) : null}
          {session.projectPath !== undefined ? (
            <span className="session-item-project" title={sessionWorkspace(session)}>
              {lastSegment(sessionWorkspace(session) ?? session.projectPath)}
            </span>
          ) : null}
          {pendingApprovals > 0 ? (
            <span
              className="session-badge session-badge--approvals"
              aria-label={t("core.sessions.approvals_badge", { count: pendingApprovals })}
            >
              {pendingApprovals}
            </span>
          ) : null}
        </span>
        <SessionDot session={session} />
      </button>
      <LifecycleMenu session={session} />
    </div>
  );
}
