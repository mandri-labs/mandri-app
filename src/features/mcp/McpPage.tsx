import { useState } from "react";
import {
  Cable,
  Globe,
  LoaderCircle,
  LogIn,
  LogOut,
  Pencil,
  Power,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { CollectionPanel } from "@/design/CollectionPanel";
import {
  deleteMcpServer,
  loginMcpServer,
  logoutMcpServer,
  reconnectMcpServer,
  updateMcpServer,
  type McpServer,
} from "@/daemon/rest/mcp";
import { mcpStore, mcpServerNeedsAttention, refreshMcp } from "@/stores/mcp";
import { openMcpAuthorizationUrl } from "@/lib/platform/externalUrl";
import { McpStatus } from "./McpStatus";
import { McpForm } from "./McpForm";
import "@/features/providers/providers.css";
import "./mcp.css";

export function McpPage() {
  const { t } = useTranslation();
  const { servers, loaded, error } = useStore(mcpStore, (state) => state);
  const [editing, setEditing] = useState<McpServer | null | undefined>();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const action = async (server: McpServer, operation: () => Promise<unknown>) => {
    setBusy(server.id);
    setFailure(null);
    try {
      await operation();
      await refreshMcp();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("core.mcp.unavailable"));
    } finally {
      setBusy(null);
    }
  };
  const iconButton = (
    server: McpServer,
    label: string,
    Icon: typeof Pencil,
    operation: () => Promise<unknown>,
  ) => (
    <button
      type="button"
      className="mcp-icon-button"
      title={label}
      aria-label={label}
      disabled={busy === server.id || server.revision === 0}
      onClick={() => void action(server, operation)}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );

  return (
    <div className="providers-page mcp-page">
      <h1 className="providers-title">{t("core.mcp.title")}</h1>
      {(error || failure) && (
        <div className="providers-form-error" role="alert">
          {failure || error}
          <button
            type="button"
            className="mcp-icon-button"
            aria-label={t("core.actions.retry")}
            onClick={() => void refreshMcp()}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {!loaded && !error && (
        <LoaderCircle size={18} className="mcp-loading" aria-label={t("core.mcp.loading")} />
      )}
      <CollectionPanel
        label={t("core.mcp.title")}
        items={[...servers].sort((a, b) => a.name.localeCompare(b.name))}
        getKey={(server) => server.id}
        addLabel={t("core.mcp.add")}
        onAdd={() => setEditing(null)}
        renderItem={(server) => {
          const Transport = server.transport === "stdio" ? Cable : Globe;
          return (
            <div className="mcp-server">
              <div className="mcp-server-row">
                <McpStatus state={server.state} />
                <span className="mcp-server-name">{server.name}</span>
                <Transport
                  size={15}
                  className="mcp-muted"
                  aria-label={t(
                    server.transport === "stdio" ? "core.mcp.local" : "core.mcp.remote",
                  )}
                />
                <span
                  className="mcp-tool-count"
                  title={t("core.mcp.tools", { count: server.tools })}
                >
                  <Wrench size={13} aria-hidden="true" />
                  {server.tools}
                </span>
                <div className="mcp-server-actions">
                  {server.auth === "oauth" &&
                    (server.authorize_url
                      ? iconButton(server, t("core.mcp.login"), LogIn, () =>
                          openMcpAuthorizationUrl(server.authorize_url!),
                        )
                      : server.state !== "ready"
                        ? iconButton(server, t("core.mcp.login"), LogIn, () =>
                            loginMcpServer(server.id),
                          )
                        : iconButton(server, t("core.mcp.logout"), LogOut, () =>
                            logoutMcpServer(server.id),
                          ))}
                  {iconButton(server, t("core.mcp.reconnect"), RefreshCw, () =>
                    reconnectMcpServer(server.id),
                  )}
                  <button
                    type="button"
                    className="mcp-icon-button"
                    aria-label={t("core.mcp.edit")}
                    title={t("core.mcp.edit")}
                    disabled={server.revision === 0}
                    onClick={() => setEditing(server)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button"
                    aria-label={t("core.mcp.remove")}
                    title={t("core.mcp.remove")}
                    onClick={() => setConfirming(server.id)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={server.enabled}
                    className={`mcp-icon-button${server.enabled ? " mcp-icon-button--enabled" : ""}`}
                    aria-label={t(server.enabled ? "core.mcp.disable" : "core.mcp.enable")}
                    disabled={busy === server.id || server.revision === 0}
                    onClick={() =>
                      void action(server, () =>
                        updateMcpServer(server, { enabled: !server.enabled }),
                      )
                    }
                  >
                    <Power size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {mcpServerNeedsAttention(server) && server.error && (
                <span className="mcp-server-error">{server.error}</span>
              )}
              {confirming === server.id && (
                <div className="providers-confirm">
                  <span>{server.name}</span>
                  <div className="providers-confirm-actions">
                    <button
                      type="button"
                      className="providers-button providers-button--danger"
                      disabled={busy === server.id}
                      onClick={() =>
                        void action(server, async () => {
                          await deleteMcpServer(server.id);
                          setConfirming(null);
                        })
                      }
                    >
                      {t("core.mcp.remove")}
                    </button>
                    <button
                      type="button"
                      className="providers-button"
                      onClick={() => setConfirming(null)}
                    >
                      {t("core.actions.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }}
      />
      {editing !== undefined && (
        <McpForm
          server={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void refreshMcp();
          }}
        />
      )}
    </div>
  );
}
