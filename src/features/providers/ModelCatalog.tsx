import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Mic,
  Search,
  Video,
  Wrench,
} from "lucide-react";
import { DaemonError } from "@/daemon/errors";
import { listProviderModels } from "@/daemon/rest/providers";
import { providersStore } from "@/stores/providers";
import type { ModelCatalogEntry, ProviderView } from "@/stores/providers";

export interface ModelCatalogProps {
  provider: ProviderView;
  defaultExpanded?: boolean;
}

function ModelCapabilities({ model }: { model: ModelCatalogEntry }) {
  const { t } = useTranslation();
  const capabilities = [
    {
      key: "reasoning",
      icon: Brain,
      enabled:
        model.reasoning_supported ?? model.reasoning_efforts.some((effort) => effort !== "off"),
    },
    { key: "vision", icon: Eye, enabled: model.image_input === true },
    { key: "tools", icon: Wrench, enabled: model.tool_call === true },
    { key: "audio", icon: Mic, enabled: model.input_modalities?.includes("audio") },
    { key: "video", icon: Video, enabled: model.input_modalities?.includes("video") },
    { key: "documents", icon: FileText, enabled: model.input_modalities?.includes("pdf") },
  ].filter((capability) => capability.enabled);

  return (
    <span className="providers-model-capabilities">
      {capabilities.length === 0 ? (
        <span className="providers-model-unknown">{t("core.models.capabilities_unknown")}</span>
      ) : (
        capabilities.map(({ key, icon: Icon }) => (
          <span
            key={key}
            className="providers-model-capability"
            role="img"
            aria-label={t(`core.models.capabilities.${key}`)}
            tabIndex={0}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="providers-model-tooltip" aria-hidden="true">
              {t(`core.models.capabilities.${key}`)}
            </span>
          </span>
        ))
      )}
    </span>
  );
}

export function ModelCatalog({ provider, defaultExpanded = false }: ModelCatalogProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [query, setQuery] = useState("");
  const models = provider.modelCatalog ?? [];

  useEffect(() => {
    if (!expanded || provider.catalogState !== "idle") return;
    const name = provider.name;
    providersStore.getState().setCatalogLoading(name);
    listProviderModels(name)
      .then((rows) => providersStore.getState().setCatalog(name, rows))
      .catch((error: unknown) => {
        if (error instanceof DaemonError && error.detail.cause === "daemon_changed") return;
        providersStore.getState().setCatalog(name, "unavailable");
      });
  }, [expanded, provider.name, provider.catalogState]);

  const filtered = models.filter((model) =>
    `${model.id} ${model.display_name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

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
        {provider.catalogState === "loaded" && (
          <span className="providers-catalog-count">{models.length}</span>
        )}
      </button>
      {expanded && (
        <div className="providers-catalog-body">
          {provider.catalogState === "loading" && (
            <div className="providers-catalog-state" role="status">
              {t("core.providers.catalog.loading")}
            </div>
          )}
          {provider.catalogState === "unavailable" && (
            <div className="providers-catalog-note" role="status">
              {t("core.providers.catalog.unavailable")}
              <button
                type="button"
                className="providers-button providers-button--small"
                onClick={() => providersStore.getState().resetCatalog(provider.name)}
              >
                {t("core.actions.retry")}
              </button>
            </div>
          )}
          {provider.catalogState === "loaded" && models.length === 0 && (
            <div className="providers-catalog-state">{t("core.providers.catalog.empty")}</div>
          )}
          {models.length > 0 && (
            <>
              <label className="providers-catalog-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t("core.providers.search_placeholder")}
                  placeholder={t("core.providers.search_placeholder")}
                />
              </label>
              <ul className="providers-catalog-list">
                {filtered.map((model) => (
                  <li key={model.id} className="providers-catalog-row">
                    <div className="providers-model-name">
                      <span>{model.display_name || model.id}</span>
                      {model.display_name && model.display_name !== model.id && (
                        <span className="providers-catalog-id">{model.id}</span>
                      )}
                    </div>
                    <ModelCapabilities model={model} />
                  </li>
                ))}
              </ul>
              {filtered.length === 0 && (
                <div className="providers-catalog-state">{t("core.providers.no_results")}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
