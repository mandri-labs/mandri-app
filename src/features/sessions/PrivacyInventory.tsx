import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOverlayFocus } from "@/app/dialogFocus";
import { getSessionPrivacy, type SessionPrivacy } from "@/daemon/rest/sessions";
import "@/features/settings/settings-modal.css";
import "./protection.css";

export function PrivacyInventoryDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayFocus(panelRef, true, onClose);
  return createPortal(
    <div className="settings-modal-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="settings-modal privacy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="privacy-dialog-header">
          <div className="privacy-dialog-heading">
            <ShieldCheck size={20} aria-hidden="true" />
            <h2 id={titleId} className="settings-modal-title">
              {t("core.protection.surrogate")}
            </h2>
          </div>
          <button
            type="button"
            className="settings-modal-close"
            aria-label={t("core.actions.close")}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <PrivacyInventory key={sessionId} sessionId={sessionId} />
        <footer className="privacy-dialog-footer">{t("core.protection.inventory_limits")}</footer>
      </div>
    </div>,
    document.body,
  );
}

export function PrivacyInventory({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SessionPrivacy>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await getSessionPrivacy(sessionId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSnapshot(result);
        setFailed(false);
      } catch {
        if (controller.signal.aborted) return;
        setFailed(true);
      }
      timer = setTimeout(() => void refresh(), 3000);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId]);
  return (
    <section className="privacy-inventory" aria-label={t("core.protection.inventory_title")}>
      <div className="privacy-inventory-intro">
        <h3>{t("core.protection.inventory_title")}</h3>
        <p>{t("core.protection.inventory_description")}</p>
      </div>
      {failed ? (
        <p role="alert" className="privacy-inventory-state">
          {t("core.protection.inventory_error")}
        </p>
      ) : snapshot ? (
        <>
          <p className="privacy-inventory-count" role="status">
            {t("core.protection.inventory_count", { count: snapshot.entries.length })}
          </p>
          <ul
            className="privacy-inventory-list"
            tabIndex={0}
            aria-label={t("core.protection.inventory_title")}
          >
            {snapshot.entries.map((entry, index) => (
              <li key={`${entry.kind}-${index}`}>
                <span>
                  {t(`core.protection.data_kinds.${entry.kind}`, {
                    defaultValue: t("core.protection.data_kinds.identity"),
                  })}
                </span>
                <code>{entry.redacted}</code>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status" className="privacy-inventory-state">
          {t("core.protection.inventory_loading")}
        </p>
      )}
    </section>
  );
}
