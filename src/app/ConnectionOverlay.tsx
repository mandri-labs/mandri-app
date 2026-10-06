import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { connectionStore } from "@/stores/connection";
import { ConnectionSettings } from "@/features/settings/ConnectionSettings";
import { isTauri } from "@/lib/platform";
import { openDesktopLogs } from "@/lib/platform/daemon";
import { useOverlayFocus } from "./dialogFocus";
import { useStore } from "./useStore";
import "@/features/transcript/shimmer.css";
import "@/features/settings/settings-modal.css";
import "./connection-overlay.css";

export const CONNECTION_GRACE_MS = 20_000;
export const CONNECTION_FADE_MS = 180;

/** Lives above the routes so navigation never restarts the connection deadline. */
export function ConnectionOverlay({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const status = useStore(connectionStore, (s) => s.status);
  const hasConnected = useStore(connectionStore, (s) => s.hasConnected);
  const disconnectedAt = useStore(connectionStore, (s) => s.disconnectedAt);
  const startupError = useStore(connectionStore, (s) => s.startupError);
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const online = status === "online";
  const overdue = disconnectedAt !== null && expiredAt === disconnectedAt;
  const blocking = !online && (!hasConnected || overdue);
  const failed = startupError !== null || status === "offline";
  const showRecovery = failed || overdue;
  const [content, setContent] = useState({ hasConnected, failed, showRecovery, startupError });

  // Freeze the last visible view during the fade, including any error details.
  useEffect(() => {
    if (blocking) setContent({ hasConnected, failed, showRecovery, startupError });
  }, [blocking, hasConnected, failed, showRecovery, startupError]);

  useEffect(() => {
    if (disconnectedAt === null) return;
    const timer = window.setTimeout(
      () => setExpiredAt(disconnectedAt),
      Math.max(0, disconnectedAt + CONNECTION_GRACE_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [disconnectedAt]);

  useEffect(() => {
    if (blocking) {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setVisible(false);
      setSettingsOpen(false);
      setLogsError(null);
    }, CONNECTION_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [blocking]);

  useOverlayFocus(panel, blocking);

  return (
    <>
      <div className="connection-app" inert={blocking} aria-hidden={blocking || undefined}>
        {children}
      </div>
      {(visible || blocking) && (
        <div
          ref={panel}
          className={`connection-overlay${blocking ? "" : " connection-overlay--leaving"}`}
          style={{ "--connection-fade-duration": `${CONNECTION_FADE_MS}ms` } as CSSProperties}
          role="dialog"
          aria-modal={blocking || undefined}
          aria-label={t("core.connection.screen_title")}
          aria-hidden={!blocking || undefined}
          tabIndex={-1}
          inert={!blocking}
          onKeyDown={(event) => {
            // Keep application shortcuts from opening another overlay underneath.
            if (event.ctrlKey || event.metaKey) event.stopPropagation();
          }}
        >
          <div className="connection-overlay-center">
            <span className="shell-brand-name connection-overlay-wordmark" aria-label="Mandri">
              Mandri
            </span>
            <p className="connection-overlay-status" role={content.failed ? "alert" : "status"}>
              <span className={content.failed ? undefined : "tr-shimmer"}>
                {t(
                  content.failed
                    ? "core.connection.failed"
                    : content.hasConnected
                      ? "core.connection.reconnecting"
                      : "core.connection.starting",
                )}
              </span>
            </p>
            {content.showRecovery && (
              <div className="connection-overlay-recovery">
                <p className="connection-overlay-note">
                  {t(content.failed ? "core.connection.failed_hint" : "core.connection.slow_hint")}
                </p>
                {content.startupError && (
                  <details className="connection-overlay-details">
                    <summary>{t("core.connection.error_details")}</summary>
                    <pre>{content.startupError}</pre>
                  </details>
                )}
                <div className="connection-overlay-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setLogsError(null);
                      onRetry();
                    }}
                  >
                    {t("core.actions.retry")}
                  </button>
                  {isTauri() && (
                    <button
                      type="button"
                      onClick={() => {
                        setLogsError(null);
                        void openDesktopLogs().catch((error: unknown) =>
                          setLogsError(String(error)),
                        );
                      }}
                    >
                      {t("core.actions.open_logs")}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={settingsOpen}
                    onClick={() => setSettingsOpen(!settingsOpen)}
                  >
                    {t("core.connection.settings")}
                  </button>
                </div>
                {logsError && (
                  <p className="connection-overlay-note" role="alert">
                    {logsError}
                  </p>
                )}
                {settingsOpen && (
                  <section
                    className="connection-overlay-settings"
                    aria-label={t("core.connection.settings")}
                  >
                    <ConnectionSettings />
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
