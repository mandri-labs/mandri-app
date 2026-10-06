import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DaemonError } from "@/daemon/errors";
import { listProviderModels, listProviders } from "@/daemon/rest/providers";
import { useModelProviders } from "@/features/providers/nativeModels";
import { modelCatalogEntry } from "@/features/providers/modelReasoning";
import { fuzzyMatch } from "@/lib/fuzzy";
import { providersStore } from "@/stores/providers";
import { harnessDisplayName, splitModelRef } from "./composerControls";

export interface ModelMenuProps {
  harness?: string;
  cwd?: string;
  onSelect: (modelRef: string) => void;
  onSelectEffort?: (effort: string | null) => void | Promise<void>;
  currentEffort?: string | null;
  currentModel?: string;
  allowNative?: boolean;
}

interface ModelEntry {
  displayName: string;
  nativeProvider?: string;
  ref: string;
  score: number;
  modelHit: number[] | null;
}

interface ModelGroup {
  provider: string;
  entries: ModelEntry[];
  startIndex: number;
}

function Highlighted({ text, indices }: { text: string; indices: number[] | null }) {
  if (indices === null || indices.length === 0) {
    return <>{text}</>;
  }
  const hits = new Set(indices);
  const parts: ReactNode[] = [];
  let buffer = "";
  let hit = false;
  let key = 0;
  const flush = (): void => {
    if (buffer.length === 0) {
      return;
    }
    parts.push(
      hit ? (
        <span key={key} className="model-menu-hit">
          {buffer}
        </span>
      ) : (
        <span key={key}>{buffer}</span>
      ),
    );
    key += 1;
    buffer = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const isHit = hits.has(i);
    if (isHit !== hit) {
      flush();
      hit = isHit;
    }
    buffer += text[i];
  }
  flush();
  return <>{parts}</>;
}

export function ModelMenu({
  onSelect,
  onSelectEffort,
  currentEffort,
  currentModel: selectedModel,
  harness,
  cwd,
  allowNative = true,
}: ModelMenuProps) {
  const currentModel =
    !allowNative && selectedModel?.startsWith("native:") ? undefined : selectedModel;
  const { t } = useTranslation();
  const [choosingModel, setChoosingModel] = useState(!currentModel);
  const [draftEffort, setDraftEffort] = useState<string | null>(null);
  const committedEffort = useRef<string | undefined>(undefined);
  const providers = useModelProviders(harness, cwd, true, allowNative);
  const select = (ref: string) => {
    if (allowNative || !ref.startsWith("native:")) onSelect(ref);
  };
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) {
      return;
    }
    hydrated.current = true;
    listProviders()
      .then((rows) => {
        providersStore.getState().hydrateProviders(rows);
      })
      .catch(() => undefined);
  }, []);
  const names = useMemo(
    () =>
      Object.keys(providers).sort(
        (a, b) =>
          Number(b.startsWith("native:")) - Number(a.startsWith("native:")) || a.localeCompare(b),
      ),
    [providers],
  );
  useEffect(() => {
    for (const name of names) {
      const provider = providers[name];
      if (
        provider === undefined ||
        provider.kind === "native" ||
        provider.catalogState !== "idle"
      ) {
        continue;
      }
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
    }
  }, [names, providers]);
  const trimmed = query.trim();
  const nativeDefaultLabel = t("core.providers.native_default");
  const providerLabel = (name: string): string =>
    name.startsWith("native:")
      ? t("core.providers.native_models", { harness: harnessDisplayName(name.slice(7), t) })
      : name;
  const groups = useMemo<ModelGroup[]>(() => {
    if (trimmed.length === 0) {
      return [];
    }
    const result: ModelGroup[] = [];
    let startIndex = 0;
    for (const name of names) {
      const provider = providers[name];
      if (provider === undefined || provider.catalogState !== "loaded") {
        continue;
      }
      const rows: ModelEntry[] = [];
      for (const model of provider.modelCatalog ?? []) {
        const modelId = model.id;
        const displayName =
          provider.kind === "native" && modelId === "default"
            ? nativeDefaultLabel
            : (model.display_name ?? modelId);
        const modelMatch = fuzzyMatch(trimmed, modelId);
        const displayMatch = fuzzyMatch(trimmed, displayName);
        const providerMatch = fuzzyMatch(trimmed, name);
        const combined = fuzzyMatch(trimmed, `${name}/${modelId}`);
        const combinedDisplay = fuzzyMatch(trimmed, `${name}/${displayName}`);
        if (
          modelMatch === null &&
          displayMatch === null &&
          providerMatch === null &&
          combined === null &&
          combinedDisplay === null
        ) {
          continue;
        }
        const score = Math.max(
          Math.max(modelMatch?.score ?? -Infinity, displayMatch?.score ?? -Infinity) +
            (providerMatch?.score ?? 0) * 0.5,
          combined?.score ?? -Infinity,
          combinedDisplay?.score ?? -Infinity,
          providerMatch !== null ? providerMatch.score * 0.5 : -Infinity,
        );
        const separator = modelId.indexOf("/");
        rows.push({
          displayName,
          nativeProvider:
            provider.kind === "native" && separator > 0 ? modelId.slice(0, separator) : undefined,
          ref: `${name}/${modelId}`,
          score,
          modelHit: displayMatch?.indices ?? null,
        });
      }
      if (rows.length > 0) {
        rows.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
        result.push({ provider: name, entries: rows, startIndex });
        startIndex += rows.length;
      }
    }
    return result;
  }, [providers, names, trimmed, nativeDefaultLabel]);
  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const exactAllowed = allowNative || !trimmed.startsWith("native:");
  const rowCount = Math.max(1, entries.length + Number(exactAllowed));
  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed]);
  useEffect(() => {
    if (choosingModel) searchRef.current?.focus();
  }, [choosingModel]);
  useEffect(() => {
    const row = resultsRef.current?.querySelector(`[data-row-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  const move = (delta: number): void => {
    setActiveIndex((current) => (current + delta + rowCount) % rowCount);
  };
  const commit = (): void => {
    if (activeIndex === entries.length) {
      select(trimmed);
      return;
    }
    const entry = entries[activeIndex];
    if (entry !== undefined) {
      select(entry.ref);
    }
  };
  const thinkingEfforts = useMemo<string[]>(() => {
    if (currentModel === undefined || currentModel.length === 0) {
      return [];
    }
    const separator = currentModel.indexOf("/");
    const providerName = currentModel.slice(0, separator);
    const provider = providers[providerName];
    if (provider === undefined || provider.catalogState !== "loaded") {
      return [];
    }
    const model = (provider.modelCatalog ?? []).find(
      (row) => row.id === currentModel.slice(separator + 1),
    );
    const efforts = [...new Set(model?.reasoning_efforts ?? [])];
    const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
    // Preserve provider order for custom levels whose intensity is unknown.
    return efforts.every((effort) => order.includes(effort))
      ? efforts.sort((a, b) => order.indexOf(a) - order.indexOf(b))
      : efforts;
  }, [providers, currentModel]);
  const effortSet =
    currentEffort !== undefined && currentEffort !== null && currentEffort.length > 0;
  const chooseEffort = (effort: string | null): void => {
    setDraftEffort(null);
    if (effort === null) committedEffort.current = undefined;
    const settled = () => {
      committedEffort.current = undefined;
    };
    void Promise.resolve(onSelectEffort?.(effort)).then(settled, settled);
  };
  const effortLabel = (effort: string) => {
    const standard = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
    return standard.includes(effort)
      ? t(`core.providers.effort_labels.${effort}`, { defaultValue: effort })
      : effort;
  };
  if (!choosingModel) {
    const separator = currentModel?.indexOf("/") ?? -1;
    const model =
      separator < 0
        ? undefined
        : providers[currentModel!.slice(0, separator)]?.modelCatalog?.find(
            (row) => row.id === currentModel!.slice(separator + 1),
          );
    const singleLevel = thinkingEfforts.length === 1;
    const selectedEffort = singleLevel
      ? thinkingEfforts[0]
      : (draftEffort ?? currentEffort ?? model?.default_effort);
    const index = thinkingEfforts.indexOf(selectedEffort ?? "");
    const sliderIndex = Math.max(0, index);
    const commitEffort = (value: string) => {
      if (singleLevel) return;
      const effort = thinkingEfforts[Number(value)];
      if (effort !== undefined && effort !== currentEffort && effort !== committedEffort.current) {
        committedEffort.current = effort;
        chooseEffort(effort);
      }
    };
    return (
      <div key="reasoning" className="model-settings" data-model-view="reasoning">
        <button
          autoFocus
          type="button"
          className="model-settings-select"
          onClick={() => setChoosingModel(true)}
        >
          <span className="model-settings-name">
            {currentModel
              ? (modelCatalogEntry(providers, currentModel)?.display_name ??
                splitModelRef(currentModel).name)
              : t("core.welcome.model_placeholder")}
          </span>
          <span className="model-settings-change">
            {t("core.providers.change_model")} <ChevronDown size={12} aria-hidden="true" />
          </span>
        </button>
        {thinkingEfforts.length > 0 && onSelectEffort ? (
          <div className="model-settings-reasoning">
            <div className="model-settings-heading">
              <span>{t("core.providers.thinking_title")}</span>
              <output>
                {index >= 0
                  ? effortLabel(thinkingEfforts[sliderIndex]!)
                  : t("core.providers.thinking_default")}
              </output>
            </div>
            <div className="model-settings-slider-wrap">
              <input
                className="model-settings-slider"
                style={{
                  background: `linear-gradient(to right, var(--color-accent) ${singleLevel ? 100 : (sliderIndex / (thinkingEfforts.length - 1)) * 100}%, var(--color-raised-hover) 0%)`,
                }}
                type="range"
                min={0}
                max={Math.max(1, thinkingEfforts.length - 1)}
                step={1}
                value={singleLevel ? 1 : sliderIndex}
                disabled={thinkingEfforts.length === 1}
                aria-label={t("core.providers.thinking_title")}
                aria-valuetext={
                  index >= 0
                    ? effortLabel(thinkingEfforts[sliderIndex]!)
                    : t("core.providers.thinking_default")
                }
                onChange={(event) =>
                  setDraftEffort(thinkingEfforts[Number(event.target.value)] ?? null)
                }
                onPointerUp={(event) => commitEffort(event.currentTarget.value)}
                onKeyUp={(event) => {
                  if (
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                    ].includes(event.key)
                  )
                    commitEffort(event.currentTarget.value);
                }}
                onBlur={(event) => {
                  if (draftEffort !== null) commitEffort(event.currentTarget.value);
                }}
              />
              <div className="model-settings-slider-ticks" aria-hidden="true">
                {thinkingEfforts.map((effort, step) => (
                  <span
                    key={effort}
                    className="model-settings-slider-tick"
                    style={{
                      left: `${singleLevel ? 100 : (step / (thinkingEfforts.length - 1)) * 100}%`,
                      visibility: step === sliderIndex ? "hidden" : "visible",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="model-settings-scale" aria-hidden="true">
              <span>{effortLabel(thinkingEfforts[0]!)}</span>
              {thinkingEfforts.length > 1 && (
                <span>{effortLabel(thinkingEfforts[thinkingEfforts.length - 1]!)}</span>
              )}
            </div>
            {effortSet && (
              <button
                type="button"
                className="model-settings-reset"
                onClick={() => chooseEffort(null)}
              >
                {t("core.providers.thinking_default")}
              </button>
            )}
          </div>
        ) : (
          <p className="model-settings-unavailable">{t("core.providers.thinking_unavailable")}</p>
        )}
      </div>
    );
  }
  return (
    <div key="catalog" className="model-menu" data-model-view="catalog">
      <div className="model-menu-search">
        {currentModel && (
          <button
            type="button"
            className="model-settings-reset"
            onClick={() => setChoosingModel(false)}
          >
            {t("core.providers.back_to_model")}
          </button>
        )}
        <input
          ref={searchRef}
          className="model-menu-input"
          value={query}
          placeholder={t("core.providers.search_placeholder")}
          aria-label={t("core.providers.search_placeholder")}
          role="combobox"
          aria-expanded="true"
          aria-controls="model-menu-results"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              commit();
            }
          }}
        />
      </div>
      <div className="model-menu-scroll">
        {names.length === 0 ? (
          <div className="model-menu-empty">{t("core.providers.empty")}</div>
        ) : null}
        {trimmed.length === 0
          ? names.map((name) => {
              const provider = providers[name];
              const models = provider?.modelCatalog ?? [];
              return (
                <div key={name} className="model-menu-group">
                  <div className="model-menu-provider">{providerLabel(name)}</div>
                  {provider?.catalogState === "loading" ? (
                    <div className="model-menu-state">{t("core.providers.catalog.loading")}</div>
                  ) : null}
                  {provider?.catalogState === "unavailable" ? (
                    <div className="model-menu-state">
                      {t("core.providers.catalog.unavailable")}
                    </div>
                  ) : null}
                  {provider?.catalogState === "loaded" && models.length === 0 ? (
                    <div className="model-menu-state">{t("core.providers.catalog.empty")}</div>
                  ) : null}
                  {models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-menu-row${currentModel === `${name}/${model.id}` ? " model-menu-row--current" : ""}`}
                      aria-current={currentModel === `${name}/${model.id}` ? "true" : undefined}
                      title={`${name}/${model.id}`}
                      onClick={() => {
                        select(`${name}/${model.id}`);
                      }}
                    >
                      <span className="model-menu-row-name">
                        {provider?.kind === "native" && model.id === "default"
                          ? nativeDefaultLabel
                          : (model.display_name ?? model.id)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          : null}
        {trimmed.length > 0 ? (
          <div
            id="model-menu-results"
            ref={resultsRef}
            className="model-menu-results"
            role="listbox"
            aria-label={t("core.start.model")}
          >
            {groups.map((group) => (
              <div
                key={group.provider}
                className="model-menu-group"
                role="group"
                aria-label={providerLabel(group.provider)}
              >
                <div className="model-menu-provider" aria-hidden="true">
                  <Highlighted
                    text={providerLabel(group.provider)}
                    indices={fuzzyMatch(trimmed, providerLabel(group.provider))?.indices ?? null}
                  />
                </div>
                {group.entries.map((entry, offset) => {
                  const index = group.startIndex + offset;
                  return (
                    <button
                      key={entry.ref}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      data-row-index={index}
                      title={entry.ref}
                      className={`model-menu-row${index === activeIndex ? " model-menu-row--active" : ""}${entry.ref === currentModel ? " model-menu-row--current" : ""}`}
                      onMouseEnter={() => {
                        setActiveIndex(index);
                      }}
                      onClick={() => {
                        select(entry.ref);
                      }}
                    >
                      <span className="model-menu-row-name">
                        <Highlighted text={entry.displayName} indices={entry.modelHit} />
                      </span>
                      {entry.nativeProvider && (
                        <span className="model-menu-row-provider">
                          <Highlighted
                            text={entry.nativeProvider}
                            indices={fuzzyMatch(trimmed, entry.nativeProvider)?.indices ?? null}
                          />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {entries.length === 0 ? (
              <div className="model-menu-empty">{t("core.providers.no_results")}</div>
            ) : null}
            {exactAllowed ? (
              <button
                type="button"
                role="option"
                aria-selected={activeIndex === entries.length}
                data-row-index={entries.length}
                className={`model-menu-row model-menu-row--exact${
                  activeIndex === entries.length ? " model-menu-row--active" : ""
                }`}
                onMouseEnter={() => {
                  setActiveIndex(entries.length);
                }}
                onClick={() => {
                  select(trimmed);
                }}
              >
                {t("core.providers.use_exact", { ref: trimmed })}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
