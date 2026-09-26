import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useOverlayFocus } from "@/app/dialogFocus";
import { registerIngest } from "@/app/framePipeline";
import { useStore } from "@/app/useStore";
import { DaemonError, daemonErrorKey } from "@/daemon/errors";
import { createRoute, deleteRoute, getGatewayInfo, setRouteModel } from "@/daemon/rest/gateway";
import { ROUTE_FORMATS, providersStore, selectVerifiedProviders } from "@/stores/providers";
import type { RouteView } from "@/stores/providers";
import "./providers.css";

interface PageFailure {
  kind: "swap" | "delete";
  code: string;
  message: string;
}

interface RouteRowProps {
  route: RouteView;
  options: { ref: string; label: string }[];
  onFailure: (failure: PageFailure) => void;
  onDelete: (routeId: string) => void;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatLabel(format: string, t: (key: string) => string): string {
  return t(`core.routes.format.${format}`);
}

function RouteRow({ route, options, onFailure, onDelete }: RouteRowProps) {
  const { t } = useTranslation();
  const knownModel = options.some((option) => option.ref === route.modelRef);
  const [selected, setSelected] = useState(knownModel ? route.modelRef : "");
  const [manualValue, setManualValue] = useState(knownModel ? "" : route.modelRef);

  const applySwap = async (model: string): Promise<void> => {
    const previous = route.modelRef;
    providersStore.getState().swapRouteModel(route.id, model);
    try {
      const row = await setRouteModel(route.id, model);
      providersStore.getState().swapRouteModel(route.id, row.model_ref);
    } catch (error) {
      providersStore.getState().swapRouteModel(route.id, previous);
      if (error instanceof DaemonError) {
        onFailure({ kind: "swap", code: error.code, message: error.message });
      }
    }
  };

  const onSelectChange = (value: string): void => {
    if (value === "manual") {
      setSelected("manual");
      return;
    }
    setSelected(value);
    if (value.length > 0) {
      void applySwap(value);
    }
  };

  const onManualSubmit = (): void => {
    const model = manualValue.trim();
    if (model.length === 0) {
      return;
    }
    setSelected(model);
    void applySwap(model);
  };

  return (
    <li className="providers-route-row">
      <div className="providers-route-head">
        <span className="providers-route-id" title={route.id}>
          {shortId(route.id)}
        </span>
        <span className="providers-route-provider">{route.providerName}</span>
        <span className="providers-catalog-id">{route.modelRef}</span>
        <span className="providers-route-formats">
          {route.formats.map((format) => (
            <span key={format} className="providers-chip">
              {formatLabel(format, t)}
            </span>
          ))}
        </span>
        <span className="providers-item-actions">
          <select
            className="providers-input providers-input--small"
            aria-label={t("core.routes.swap")}
            value={selected}
            onChange={(event) => onSelectChange(event.target.value)}
          >
            <option value="">{t("core.routes.swap")}</option>
            {options.map((option) => (
              <option key={option.ref} value={option.ref}>
                {option.label}
              </option>
            ))}
            <option value="manual">{t("core.routes.swap_manual")}</option>
          </select>
          <button
            type="button"
            className="providers-button providers-button--small providers-button--danger"
            onClick={() => onDelete(route.id)}
          >
            {t("core.routes.delete")}
          </button>
        </span>
      </div>
      {selected === "manual" && (
        <div className="providers-route-manual">
          <input
            type="text"
            className="providers-input providers-input--small"
            placeholder={t("core.routes.model_placeholder")}
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
          />
          <button
            type="button"
            className="providers-button providers-button--small providers-button--primary"
            onClick={onManualSubmit}
          >
            {t("core.routes.swap")}
          </button>
        </div>
      )}
    </li>
  );
}

export function RoutesPage() {
  const { t } = useTranslation();
  const routes = useStore(providersStore, (state) => state.routes);
  const routesLoaded = useStore(providersStore, (state) => state.routesLoaded);
  const providers = useStore(providersStore, (state) => state.providers);
  const [createOpen, setCreateOpen] = useState(false);
  const [modelValue, setModelValue] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [createFailure, setCreateFailure] = useState<PageFailure | undefined>(undefined);
  const [pageFailure, setPageFailure] = useState<PageFailure | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const createPanelRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(createPanelRef, createOpen, () => {
    setCreateOpen(false);
  });

  const refresh = useCallback(() => {
    setLoadFailure(null);
    getGatewayInfo()
      .then((info) => {
        providersStore.getState().hydrateProviders(info.providers);
        providersStore.getState().setRoutes(info.routes);
      })
      .catch((error: unknown) => setLoadFailure(daemonErrorKey(error)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unregister = registerIngest((frame) => {
      if ("topic" in frame && frame.topic === "gateway.events") {
        refresh();
      }
    });
    return unregister;
  }, [refresh]);

  const options = selectVerifiedProviders({ providers }).flatMap((provider) =>
    (provider.modelCatalog ?? []).map((model) => ({
      ref: `${provider.name}/${model.id}`,
      label: `${provider.name}/${model.id}`,
    })),
  );

  const onCreate = async (): Promise<void> => {
    const model = modelValue.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(model)) {
      setCreateFailure({ kind: "swap", code: "route_invalid", message: "" });
      return;
    }
    setCreating(true);
    try {
      const created = await createRoute({ model, formats });
      const view: RouteView = {
        id: created.id,
        providerName: created.provider,
        modelRef: created.model_ref,
        formats: [...created.formats],
        createdAt: created.created_at,
      };
      providersStore.getState().setRoutes([...providersStore.getState().routes, view]);
      setCreateOpen(false);
      setModelValue("");
      setFormats([]);
      setCreateFailure(undefined);
    } catch (error) {
      if (error instanceof DaemonError) {
        setCreateFailure({ kind: "swap", code: error.code, message: error.message });
      }
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (routeId: string): Promise<void> => {
    setPageFailure(undefined);
    try {
      await deleteRoute(routeId);
      providersStore
        .getState()
        .setRoutes(providersStore.getState().routes.filter((route) => route.id !== routeId));
    } catch (error) {
      if (error instanceof DaemonError) {
        setPageFailure({ kind: "delete", code: error.code, message: error.message });
      }
    } finally {
      setConfirmDelete(undefined);
    }
  };

  return (
    <div className="providers-page">
      <div className="providers-toolbar">
        <h1 className="providers-title">{t("core.routes.title")}</h1>
        <button
          type="button"
          className="providers-button providers-button--primary"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={14} aria-hidden="true" />
          {t("core.routes.create")}
        </button>
      </div>

      {loadFailure && (
        <div className="providers-form-error" role="alert">
          {t(loadFailure)}{" "}
          <button className="providers-button" onClick={refresh}>
            {t("core.actions.retry")}
          </button>
        </div>
      )}
      {pageFailure !== undefined && (
        <div className="providers-form-error" role="alert">
          {t(`error.${pageFailure.code}`)}
        </div>
      )}

      {!routesLoaded && <div className="providers-empty">{t("core.routes.loading")}</div>}
      {routesLoaded && routes.length === 0 && (
        <div className="providers-empty">{t("core.routes.empty")}</div>
      )}

      <ul className="providers-routes">
        {routes.map((route) => (
          <li key={route.id} className="providers-route-item">
            <RouteRow
              route={route}
              options={options}
              onFailure={(failure) =>
                setPageFailure({ kind: failure.kind, code: failure.code, message: failure.message })
              }
              onDelete={(routeId) => {
                setPageFailure(undefined);
                setConfirmDelete(routeId);
              }}
            />
            {confirmDelete === route.id && (
              <div className="providers-confirm">
                <span>{t("core.routes.delete_confirm")}</span>
                <span className="providers-confirm-actions">
                  <button
                    type="button"
                    className="providers-button providers-button--small providers-button--danger"
                    onClick={() => void onDelete(route.id)}
                  >
                    {t("core.actions.confirm")}
                  </button>
                  <button
                    type="button"
                    className="providers-button providers-button--small"
                    onClick={() => setConfirmDelete(undefined)}
                  >
                    {t("core.actions.cancel")}
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {routes.length > 0 && <p className="providers-note">{t("core.routes.delete_note")}</p>}

      {createOpen && (
        <div
          className="providers-dialog-backdrop"
          role="presentation"
          onClick={() => setCreateOpen(false)}
        >
          <div
            ref={createPanelRef}
            className="providers-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("core.routes.create_title")}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="providers-dialog-title">{t("core.routes.create_title")}</h2>
            <form
              className="providers-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void onCreate();
              }}
            >
              <label className="providers-field">
                <span className="providers-field-label">{t("core.routes.model")}</span>
                <input
                  type="text"
                  className="providers-input"
                  placeholder={t("core.routes.model_placeholder")}
                  value={modelValue}
                  onChange={(event) => setModelValue(event.target.value)}
                />
              </label>
              <fieldset className="providers-field providers-fieldset">
                <legend className="providers-field-label">{t("core.routes.formats")}</legend>
                {ROUTE_FORMATS.map((format) => (
                  <label key={format} className="providers-check">
                    <input
                      type="checkbox"
                      checked={formats.includes(format)}
                      onChange={(event) => {
                        setFormats((current) =>
                          event.target.checked
                            ? [...current, format]
                            : current.filter((entry) => entry !== format),
                        );
                      }}
                    />
                    <span>{formatLabel(format, t)}</span>
                  </label>
                ))}
              </fieldset>
              {createFailure !== undefined && (
                <div className="providers-form-error" role="alert">
                  {t(`error.${createFailure.code}`)}
                </div>
              )}
              <div className="providers-dialog-actions">
                <button
                  type="button"
                  className="providers-button"
                  onClick={() => setCreateOpen(false)}
                >
                  {t("core.actions.cancel")}
                </button>
                <button
                  type="submit"
                  className="providers-button providers-button--primary"
                  disabled={creating || modelValue.trim().length === 0 || formats.length === 0}
                >
                  {creating ? t("core.providers.form.saving") : t("core.routes.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
