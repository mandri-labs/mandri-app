import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { isUnread, type ConversationStatus, type ConversationTarget } from "@/daemon/types/conversationStatus";
import { conversationStatusStore } from "@/stores/conversationStatus";
import "./conversation-status.css";

export function ConversationIndicator({ target, fallback }: {
  target: ConversationTarget;
  fallback?: ConversationStatus["work_state"];
}) {
  const { t } = useTranslation();
  const status = useStore(conversationStatusStore, (state) => state.statuses[target]);
  const work = status?.work_state ?? fallback ?? "idle";
  const indicator = work === "working" || work === "waiting" ? work
    : isUnread(status) ? "unread" : work === "unknown" ? "unknown" : null;
  if (indicator === null) return <span className="conversation-indicator-slot" aria-hidden="true" />;
  const label = t(indicator === "unread" ? `core.status.unread_${status?.outcome ?? "completed"}`
    : `core.status.${indicator}`);
  return <span className="conversation-indicator-slot">
    <span className={`conversation-indicator conversation-indicator--${indicator}`}
      role="img" aria-label={label} title={label} />
  </span>;
}
