import i18next from "@/i18n";
import { isTauri } from "@/lib/platform";
import { getNotifier } from "@/lib/platform/notify";
import { classifyKind } from "@/stores/approvals";
import { preferencesStore } from "@/stores/preferences";
import type { ApprovalPendingMessage } from "@/daemon/types/ws";
import { registerIngest } from "./framePipeline";
import { navigate } from "./useHashRoute";

const MAX_TRACKED = 200;
const notified = new Set<string>();

function isUnfocused(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.hidden || !document.hasFocus();
}

function sessionIdOf(message: ApprovalPendingMessage): string {
  if (message.topic.startsWith("session.")) {
    return message.topic.slice("session.".length);
  }
  const raw = message.raw;
  const sessionId =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)["session_id"]
      : undefined;
  return typeof sessionId === "string" ? sessionId : message.approval_id;
}

async function deliver(message: ApprovalPendingMessage): Promise<void> {
  if (notified.has(message.approval_id)) {
    return;
  }
  notified.add(message.approval_id);
  if (notified.size > MAX_TRACKED) {
    for (const id of notified) {
      notified.delete(id);
      if (notified.size <= MAX_TRACKED) {
        break;
      }
    }
  }
  const notifier = await getNotifier();
  if (!(await notifier.isSupported())) {
    return;
  }
  const kindLabel = i18next.t(`core.approvals.kind_${classifyKind(message.source, message.raw)}`);
  const title = i18next.t("core.notifications.approval_title");
  const body = i18next.t("core.notifications.approval_body", {
    harness: message.source,
    kind: kindLabel,
  });
  if (!isTauri() && typeof Notification !== "undefined") {
    if (Notification.permission !== "granted") {
      const granted = await notifier.requestPermission();
      if (!granted) {
        return;
      }
    }
    const notification = new Notification(title, { body });
    notification.onclick = () => {
      window.focus();
      notification.close();
      navigate({ name: "session", id: sessionIdOf(message) });
    };
    return;
  }
  await notifier.notify(title, body);
}

export function initApprovalNotifications(): () => void {
  return registerIngest((frame) => {
    if (!("type" in frame) || frame.type !== "approval.pending") {
      return;
    }
    if (!preferencesStore.getState().approvalNotifications) {
      return;
    }
    if (!isUnfocused()) {
      return;
    }
    void deliver(frame);
  });
}
