import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DaemonError } from "@/daemon/errors";
import { getGatewayModelMetadata } from "@/daemon/rest/gateway";
import { listProviderModels } from "@/daemon/rest/providers";
import { providersStore } from "@/stores/providers";
import type { ProviderView } from "@/stores/providers";

export interface ModelCatalogProps {
  provider: ProviderView;
  defaultExpanded?: boolean;
  onUseModel?: (modelRef: string) => void;
}

interface MetadataEntry {
  status: "loading" | "loaded" | "failed";
  data?: Record<string, unknown>;
}

const METADATA_KEYS = [
  "context_window",
  "context_length",
  "max_input_tokens",
  "max_output_tokens",
  "max_tokens",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataLabel(key: string, t: (key: string) => string): string {
  if (key === "context_window" || key === "context_length") {
    return t("core.models.context_window");
  }
  if (key === "max_output_tokens" || key === "max_tokens") {
    return t("core.models.max_output_tokens");
  }
  if (key === "max_input_tokens") {
    return t("core.models.max_input_tokens");
  }
  return key;
}

export function ModelCatalog({ provider, defaultExpanded = false, onUseModel }: ModelCatalogProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [metadata, setMetadata] = useState<Record<string, MetadataEntry>>({});
  const models = provider.modelCatalog ?? [];

  useEffect(() => {
    if (!expanded || provider.catalogState !== "idle") {
      return;
    }
    const name = provider.name;
    providersStore.getState().setCatalogLoading(name);
    listProviderModels(name)
      .then((models) => {
        providersStore.getState().setCatalog(name, models);
      })
      .catch((error: unknown) => {
        if (error instanceof DaemonError && error.detail.cause === "daemon_changed") return;
        if (error instanceof DaemonError) {
          providersStore.getState().setCatalog(name, "unavailable");
        } else {
          providersStore.getState().setCatalog(name, []);
        }
      });
  }, [expanded, provider.name, provider.catalogState]);

  const loadMetadata = (modelRef: string): void => {
    setMetadata((current) => ({ ...current, [modelRef]: { status: "loading" } }));
    getGatewayModelMetadata(modelRef)
      .then((payload) => {
        setMetadata((current) => ({
          ...current,
          [modelRef]: {
            status: "loaded",
            data: isRecord(payload) ? payload : undefined,
          },
        }));
      })
      .catch(() => {
        setMetadata((current) => ({ ...current, [modelRef]: { status: "failed" } }));
      });
  };

  const useModel = (modelRef: string): void => {
    void navigator.clipboard?.writeText(modelRef).catch(() => undefined);
    onUseModel?.(modelRef);
  };

  return (
    <div className="providers-catalog">
      <button
        type="button"
        className="providers-catalog-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <span>{t("core.providers.catalog.toggle")}</span>
      </button>
      {expanded && (
        <div className="providers-catalog-body">
          {provider.catalogState === "loading" && (
            <div className="providers-catalog-state">{t("core.providers.catalog.loading")}</div>
          )}
          {provider.catalogState === "unavailable" && (
            <div className="providers-catalog-note">
              {t("core.providers.catalog.unavailable")}
              <span className="providers-catalog-note-detail">{t("core.models.manual_entry")}</span>
            </div>
          )}
          {provider.catalogState === "loaded" && models.length === 0 && (
            <div className="providers-catalog-state">{t("core.providers.catalog.empty")}</div>
          )}
          {models.length > 0 && (
            <ul className="providers-catalog-list">
              {models.map((model) => {
                const modelRef = `${provider.name}/${model.id}`;
                const entry = metadata[model.id];
                return (
                  <li key={model.id} className="providers-catalog-row">
                    <span className="providers-catalog-id">{modelRef}</span>
                    <span className="providers-catalog-actions">
                      <button
                        type="button"
                        className="providers-button providers-button--small"
                        onClick={() => useModel(modelRef)}
                      >
                        {t("core.providers.catalog.use")}
                      </button>
                      <button
                        type="button"
                        className="providers-button providers-button--small"
                        onClick={() => loadMetadata(model.id)}
                      >
                        {t("core.providers.catalog.metadata")}
                      </button>
                    </span>
                    {entry !== undefined && (
                      <div className="providers-metadata">
                        {entry.status === "loading" && (
                          <span className="providers-metadata-line">
                            {t("core.providers.catalog.metadata_loading")}
                          </span>
                        )}
                        {entry.status === "failed" && (
                          <span className="providers-metadata-line providers-metadata-line--muted">
                            {t("core.models.metadata_unavailable")}
                          </span>
                        )}
                        {entry.status === "loaded" &&
                          (entry.data === undefined ? (
                            <span className="providers-metadata-line providers-metadata-line--muted">
                              {t("core.models.metadata_unavailable")}
                            </span>
                          ) : (
                            METADATA_KEYS.filter(
                              (key) => typeof entry.data?.[key] === "number",
                            ).map((key) => (
                              <span key={key} className="providers-metadata-line">
                                {metadataLabel(key, t)}: {String(entry.data?.[key])}
                              </span>
                            ))
                          ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
