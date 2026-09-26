import { useId, useState } from "react";
import { Check } from "lucide-react";
import { CollectionPanel } from "@/design/CollectionPanel";
import { EndpointIcon } from "@/design/EndpointIcon";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { connectDaemon } from "@/app/connection";
import { preferencesStore } from "@/stores/preferences";
import { LOCAL_ENDPOINT, normalizeEndpointUrl, type DaemonEndpoint } from "@/stores/endpoints";

export function ConnectionSettings() {
  const { t } = useTranslation();
  const fieldId = useId();
  const endpoints = useStore(preferencesStore, (state) => state.endpoints);
  const selected = useStore(preferencesStore, (state) => state.selectedEndpointId);
  const [draft, setDraft] = useState<DaemonEndpoint | null>(null);
  const url = draft ? normalizeEndpointUrl(draft.url) : null;
  const duplicate = draft && endpoints.some((entry) => entry.id !== draft.id && entry.url === url);
  const select = (id: string) => {
    preferencesStore.getState().selectEndpoint(id);
    connectDaemon();
  };
  return (
    <CollectionPanel
      label={t("core.settings.connection.endpoints")}
      items={endpoints}
      getKey={(endpoint) => endpoint.id}
      isSelected={(endpoint) => selected === endpoint.id}
      addLabel={t("core.settings.connection.add")}
      onAdd={() => setDraft({ id: crypto.randomUUID(), name: "", url: "" })}
      renderItem={(endpoint) => (
        <div className="settings-endpoint">
          <button
            type="button"
            className="settings-endpoint-select"
            aria-pressed={selected === endpoint.id}
            onClick={() => select(endpoint.id)}
          >
            <EndpointIcon local={endpoint.id === LOCAL_ENDPOINT.id} size={18} />
            <span className="settings-endpoint-info">
              <strong>{endpoint.name}</strong>
              <span>{endpoint.url}</span>
            </span>
            {selected === endpoint.id && (
              <Check size={18} aria-label={t("core.settings.connection.selected")} />
            )}
          </button>
          {endpoint.id !== LOCAL_ENDPOINT.id && (
            <div className="settings-endpoint-actions">
              <button
                type="button"
                className="settings-pill"
                onClick={() => setDraft({ ...endpoint })}
              >
                {t("core.actions.edit")}
              </button>
              <button
                type="button"
                className="settings-pill settings-pill--danger"
                onClick={() => {
                  preferencesStore.getState().removeEndpoint(endpoint.id);
                  if (draft?.id === endpoint.id) setDraft(null);
                  if (selected === endpoint.id) connectDaemon();
                }}
              >
                {t("core.actions.remove")}
              </button>
            </div>
          )}
        </div>
      )}
      editor={
        draft ? (
          <form
            className="settings-endpoint-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!url || !draft.name.trim() || duplicate) return;
              preferencesStore.getState().saveEndpoint({ ...draft, url });
              select(draft.id);
              setDraft(null);
            }}
          >
            <div className="settings-modal-field">
              <label className="settings-modal-field-label" htmlFor={`${fieldId}-name`}>
                {t("core.settings.connection.name")}
              </label>
              <input
                autoFocus
                id={`${fieldId}-name`}
                className="settings-modal-input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="settings-modal-field">
              <label className="settings-modal-field-label" htmlFor={`${fieldId}-url`}>
                {t("core.settings.daemon.base_url")}
              </label>
              <input
                id={`${fieldId}-url`}
                className="settings-modal-input"
                value={draft.url}
                placeholder="http://desktop:8787"
                spellCheck={false}
                aria-invalid={!!draft.url && (!url || !!duplicate)}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
              {draft.url && !url && (
                <p className="settings-modal-error" role="alert">
                  {t("core.settings.daemon.base_url_invalid")}
                </p>
              )}
              {duplicate && (
                <p className="settings-modal-error" role="alert">
                  {t("core.settings.connection.duplicate")}
                </p>
              )}
            </div>
            <div className="settings-modal-actions">
              <button
                className="settings-pill settings-pill--primary"
                type="submit"
                disabled={!url || !draft.name.trim() || !!duplicate}
              >
                {t("core.settings.daemon.save")}
              </button>
              <button className="settings-pill" type="button" onClick={() => setDraft(null)}>
                {t("core.actions.cancel")}
              </button>
            </div>
          </form>
        ) : null
      }
    />
  );
}
