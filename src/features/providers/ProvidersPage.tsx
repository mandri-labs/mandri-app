import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CollectionPanel } from "@/design/CollectionPanel";
import { useStore } from "@/app/useStore";
import { DaemonError, daemonErrorKey } from "@/daemon/errors";
import { getGatewayInfo } from "@/daemon/rest/gateway";
import { deleteProvider, listProviders } from "@/daemon/rest/providers";
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
      }
    } finally {
      setConfirmingRemove(undefined);
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
                aria-expanded={expandedName === provider.name}
                onClick={() =>
                  setExpandedName(expandedName === provider.name ? undefined : provider.name)
                }
              >
                <span className="providers-item-name">{provider.name}</span>
                <span className="providers-item-kind">
                  {t(`core.providers.kind.${provider.kind}`)}
                </span>
              </button>
              {provider.state === "pending_auth" && (
                <span className="providers-auth-state">
                  {t("core.providers.state.pending_auth")}
                </span>
              )}
              <span className="providers-item-actions">
                <button
                  type="button"
                  className="providers-button providers-button--small"
                  onClick={() => {
                    setEditing(provider);
                    setFormOpen(true);
                  }}
                >
                  {t(
                    provider.kind === "chatgpt"
                      ? `core.providers.oauth.${provider.state === "pending_auth" ? "connect" : "reconnect"}`
                      : "core.providers.edit",
                  )}
                </button>
                <button
                  type="button"
                  className="providers-button providers-button--small providers-button--danger"
                  onClick={() => beginRemove(provider.name)}
                >
                  {t("core.providers.remove")}
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
                    onClick={() => void confirmRemove(provider.name)}
                  >
                    {t("core.actions.confirm")}
                  </button>
                  <button
                    type="button"
                    className="providers-button providers-button--small"
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
            {expandedName === provider.name && provider.state !== "pending_auth" && (
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
