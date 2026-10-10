import { useEffect, useState } from "react";
import {
  ChevronDown,
  CircleCheck,
  CircleHelp,
  CirclePause,
  LoaderCircle,
  LogIn,
  Pencil,
  Power,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CollectionPanel } from "@/design/CollectionPanel";
import { useStore } from "@/app/useStore";
import { DaemonError, daemonErrorKey } from "@/daemon/errors";
import { getGatewayInfo } from "@/daemon/rest/gateway";
import {
  deleteProvider,
  listProviders,
  updateProvider,
  verifyProvider,
} from "@/daemon/rest/providers";
import { providersStore } from "@/stores/providers";
import type { ProviderView } from "@/stores/providers";
import { ModelCatalog } from "./ModelCatalog";
import { ProviderFormDialog } from "./ProviderForm";
import "./providers.css";

interface RemoveFailure {
  name: string;
  routeIds: string[];
  code: string;
  message: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function ProvidersPage() {
  const { t } = useTranslation();
  const providers = useStore(providersStore, (state) => state.providers);
  const routes = useStore(providersStore, (state) => state.routes);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderView | undefined>(undefined);
  const [confirmingRemove, setConfirmingRemove] = useState<string | undefined>(undefined);
  const [removeFailure, setRemoveFailure] = useState<RemoveFailure | undefined>(undefined);
  const [expandedName, setExpandedName] = useState<string | undefined>(undefined);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | undefined>();
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadFailure(null);
    listProviders()
      .then((rows) => {
        if (!cancelled) {
          providersStore.getState().hydrateProviders(rows);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadFailure(daemonErrorKey(error));
      });
    getGatewayInfo()
      .then((info) => {
        if (cancelled) {
          return;
        }
        providersStore.getState().hydrateProviders(info.providers);
        providersStore.getState().setRoutes(info.routes);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadFailure(daemonErrorKey(error));
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const orderedProviders = Object.values(providers).sort((a, b) => a.name.localeCompare(b.name));

  const beginRemove = (name: string): void => {
    setRemoveFailure(undefined);
    setConfirmingRemove(name);
  };

  const confirmRemove = async (name: string): Promise<void> => {
    setBusy(name);
    setActionFailure(null);
    try {
      await deleteProvider(name);
      providersStore.getState().removeProvider(name);
    } catch (error) {
      if (error instanceof DaemonError) {
        setRemoveFailure({
          name,
          routeIds:
            error.code === "provider_in_use" ? asStringArray(error.detail["route_ids"]) : [],
          code: error.code,
          message: error.message,
        });
      } else {
        setActionFailure(daemonErrorKey(error));
      }
    } finally {
      setConfirmingRemove(undefined);
      setBusy(undefined);
    }
  };

  const action = async (provider: ProviderView, operation: () => Promise<void>) => {
    setBusy(provider.name);
    setActionFailure(null);
    try {
      await operation();
    } catch (error) {
      setActionFailure(daemonErrorKey(error));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="providers-page">
      <h1 className="providers-title">{t("core.providers.title")}</h1>

      {loadFailure && (
        <div className="providers-form-error" role="alert">
          {t(loadFailure)}{" "}
          <button className="providers-button" onClick={() => setRefresh((value) => value + 1)}>
            {t("core.actions.retry")}
          </button>
        </div>
      )}
      {actionFailure && (
        <div className="providers-form-error" role="alert">
          {t(actionFailure)}
        </div>
      )}
      <CollectionPanel
        label={t("core.providers.title")}
        items={orderedProviders}
        getKey={(provider) => provider.name}
        emptyMessage={loadFailure ? undefined : t("core.providers.empty")}
        addLabel={t("core.providers.add")}
        onAdd={() => {
          setEditing(undefined);
          setFormOpen(true);
        }}
        renderItem={(provider) => (
          <div className="providers-item">
            <div className="providers-item-head">
              <button
                type="button"
                className="providers-item-toggle"
                disabled={provider.enabled === false}
                aria-expanded={expandedName === provider.name}
                onClick={() =>
                  setExpandedName(expandedName === provider.name ? undefined : provider.name)
                }
              >
                {busy === provider.name ? (
                  <LoaderCircle
                    size={16}
                    className="providers-status providers-status--loading"
                    aria-label={t("core.providers.loading")}
                  />
                ) : provider.enabled === false ? (
                  <CirclePause
                    size={16}
                    className="providers-status providers-status--disabled"
                    aria-label={t("core.providers.state.disabled")}
                  />
                ) : provider.state === "verified" ? (
                  <CircleCheck
                    size={16}
                    className="providers-status providers-status--verified"
                    aria-label={t("core.providers.state.verified")}
                  />
                ) : provider.state === "unverified" ? (
                  <CircleHelp
                    size={16}
                    className="providers-status"
                    aria-label={t("core.providers.state.unverified")}
                  />
                ) : (
                  <TriangleAlert
                    size={16}
                    className="providers-status providers-status--warning"
                    aria-label={t(`core.providers.state.${provider.state}`)}
                  />
                )}
                <span className="providers-item-name">{provider.name}</span>
                <span className="providers-item-kind">
                  {t(`core.providers.kind.${provider.kind}`)}
                </span>
                <ChevronDown
                  size={14}
                  className={`providers-expand${expandedName === provider.name ? " providers-expand--open" : ""}`}
                  aria-hidden="true"
                />
              </button>
              <span className="providers-item-actions">
                {provider.kind !== "chatgpt" && (
                  <button
                    type="button"
                    className="providers-icon-button"
                    disabled={busy !== undefined || provider.enabled === false}
                    aria-label={t("core.providers.verify")}
                    title={t("core.providers.verify")}
                    onClick={() =>
                      void action(provider, async () => {
                        providersStore
                          .getState()
                          .upsertProvider(await verifyProvider(provider.name));
                      })
                    }
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="providers-icon-button"
                  disabled={busy !== undefined}
                  aria-label={t(
                    provider.kind === "chatgpt"
                      ? `core.providers.oauth.${provider.state === "pending_auth" ? "connect" : "reconnect"}`
                      : "core.providers.edit",
                  )}
                  title={t(
                    provider.kind === "chatgpt"
                      ? `core.providers.oauth.${provider.state === "pending_auth" ? "connect" : "reconnect"}`
                      : "core.providers.edit",
                  )}
                  onClick={() => {
                    setEditing(provider);
                    setFormOpen(true);
                  }}
                >
                  {provider.kind === "chatgpt" ? (
                    provider.state === "pending_auth" ? (
                      <LogIn size={16} aria-hidden="true" />
                    ) : (
                      <RefreshCw size={16} aria-hidden="true" />
                    )
                  ) : (
                    <Pencil size={16} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="providers-icon-button"
                  disabled={busy !== undefined}
                  aria-label={t("core.providers.remove")}
                  title={t("core.providers.remove")}
                  onClick={() => beginRemove(provider.name)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={provider.enabled !== false}
                  className={`providers-icon-button${provider.enabled !== false ? " providers-icon-button--enabled" : ""}`}
                  disabled={busy !== undefined}
                  aria-label={t(
                    provider.enabled === false ? "core.providers.enable" : "core.providers.disable",
                  )}
                  title={t(
                    provider.enabled === false ? "core.providers.enable" : "core.providers.disable",
                  )}
                  onClick={() =>
                    void action(provider, async () => {
                      providersStore.getState().upsertProvider(
                        await updateProvider(provider.name, {
                          enabled: provider.enabled === false,
                        }),
                      );
                    })
                  }
                >
                  <Power size={16} aria-hidden="true" />
                </button>
              </span>
            </div>
            {confirmingRemove === provider.name && (
              <div className="providers-confirm">
                <span>{t("core.providers.remove_confirm")}</span>
                <span className="providers-confirm-actions">
                  <button
                    type="button"
                    className="providers-button providers-button--small providers-button--danger"
                    disabled={busy !== undefined}
                    onClick={() => void confirmRemove(provider.name)}
                  >
                    {t("core.actions.confirm")}
                  </button>
                  <button
                    type="button"
                    className="providers-button providers-button--small"
                    disabled={busy !== undefined}
                    onClick={() => setConfirmingRemove(undefined)}
                  >
                    {t("core.actions.cancel")}
                  </button>
                </span>
              </div>
            )}
            {removeFailure !== undefined && removeFailure.name === provider.name && (
              <div className="providers-refusal" role="alert">
                <span className="providers-refusal-title">{t(`error.${removeFailure.code}`)}</span>
                {removeFailure.routeIds.length > 0 && (
                  <>
                    <span className="providers-refusal-note">
                      {t("core.providers.remove_blocked")}
                    </span>
                    <ul className="providers-refusal-routes">
                      {removeFailure.routeIds.map((routeId) => {
                        const route = routes.find((entry) => entry.id === routeId);
                        return (
                          <li key={routeId} className="providers-refusal-route">
                            <span className="providers-refusal-route-id">
                              {routeId.slice(0, 8)}
                            </span>
                            {route !== undefined && (
                              <span className="providers-catalog-id">{route.modelRef}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <span className="providers-refusal-note">
                      {t("core.providers.remove_blocked_note")}
                    </span>
                  </>
                )}
              </div>
            )}
            {expandedName === provider.name &&
              provider.enabled !== false &&
              provider.state !== "pending_auth" && (
                <ModelCatalog provider={provider} defaultExpanded />
              )}
          </div>
        )}
      />

      <ProviderFormDialog
        open={formOpen}
        provider={editing}
        onSaved={() => {
          setFormOpen(false);
          setRefresh((value) => value + 1);
        }}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
