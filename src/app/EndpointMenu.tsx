import { useRef, useState } from "react";
import { Check, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EndpointIcon } from "@/design/EndpointIcon";
import { ChipPopover } from "@/features/transcript/ChipPopover";
import { preferencesStore } from "@/stores/preferences";
import { connectionStore } from "@/stores/connection";
import { LOCAL_ENDPOINT } from "@/stores/endpoints";
import { connectDaemon } from "./connection";
import { StatusDot } from "./StatusDot";
import { useStore } from "./useStore";
import { navigate } from "./useHashRoute";
import "@/features/transcript/composer.css";
import "@/features/sessions/permissions.css";
import "./endpoint-menu.css";

export function EndpointMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const endpoints = useStore(preferencesStore, (state) => state.endpoints);
  const selected = useStore(preferencesStore, (state) => state.selectedEndpointId);
  const status = useStore(connectionStore, (state) => state.status);
  const endpoint = endpoints.find((entry) => entry.id === selected) ?? LOCAL_ENDPOINT;
  return (
    <div className="shell-endpoint" ref={anchor}>
      <button
        type="button"
        className="shell-connection"
        title={`${endpoint.url} · ${t(`core.connection.${status}`)}`}
        aria-label={`${t("core.settings.nav.connection")}: ${endpoint.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <EndpointIcon local={endpoint.id === LOCAL_ENDPOINT.id} size={14} />
        <span className="shell-endpoint-name">{endpoint.name}</span>
        <span
          className="shell-endpoint-status"
          role="img"
          aria-label={t(`core.connection.${status}`)}
        >
          <StatusDot status={status} />
        </span>
      </button>
      {open && (
        <ChipPopover anchorRef={anchor} align="start" onClose={() => setOpen(false)}>
          <div
            className="permission-menu endpoint-menu"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                      buttons.length;
              event.preventDefault();
              buttons[next]?.focus();
            }}
          >
            <div className="endpoint-menu-heading">{t("core.settings.connection.endpoints")}</div>
            {endpoints.map((entry) => (
              <button
                type="button"
                className="permission-option"
                key={entry.id}
                aria-pressed={entry.id === selected}
                onClick={() => {
                  setOpen(false);
                  if (entry.id !== selected) {
                    preferencesStore.getState().selectEndpoint(entry.id);
                    navigate({ name: "dashboard" });
                    connectDaemon();
                  }
                }}
              >
                <EndpointIcon local={entry.id === LOCAL_ENDPOINT.id} />
                <span className="endpoint-menu-copy">
                  <span className="permission-option-label">{entry.name}</span>
                  <span className="permission-option-description">{entry.url}</span>
                </span>
                {entry.id === selected && <Check size={16} aria-hidden="true" />}
              </button>
            ))}
            <div className="endpoint-menu-divider" role="separator" />
            <button
              type="button"
              className="permission-option"
              onClick={() => {
                setOpen(false);
                navigate({ name: "settings", section: "connection" });
              }}
            >
              <Settings size={16} aria-hidden="true" />
              <span className="endpoint-menu-copy permission-option-label">
                {t("core.settings.connection.manage")}
              </span>
            </button>
          </div>
        </ChipPopover>
      )}
    </div>
  );
}
