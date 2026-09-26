import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { preferencesStore } from "@/stores/preferences";
import { ModelPopover } from "@/features/transcript/ModelPopover";
import "@/features/transcript/composer.css";

export function DefaultModelSettings({ harness }: { harness: string }) {
  const { t } = useTranslation();
  const model = useStore(preferencesStore, (state) => state.defaultModel);
  const effort = useStore(preferencesStore, (state) => state.defaultEffort);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div className="settings-modal-field">
      <span className="settings-modal-field-label" id="settings-model-label">
        {t("core.settings.defaults.model")}
      </span>
      <div ref={anchor} className="settings-model-anchor">
        <button
          type="button"
          className="settings-modal-input settings-model-trigger"
          aria-label={t("core.settings.defaults.model")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span>{model || t("core.welcome.model_placeholder")}</span>
          {effort && <span className="composer-chip-suffix">{effort}</span>}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {open && (
          <ModelPopover
            anchorRef={anchor}
            placement="bottom"
            onClose={() => setOpen(false)}

            harness={harness}
            currentModel={model}
            currentEffort={effort}
            onSelect={(value) => {
              preferencesStore.getState().setDefaultHarness(harness);
              preferencesStore.getState().setDefaultModel(value || undefined);
              setOpen(false);
            }}
            onSelectEffort={(value) => preferencesStore.getState().setDefaultEffort(value)}
          />
        )}
      </div>
      <p className="settings-modal-hint">{t("core.settings.defaults.model_hint")}</p>
      {model && (
        <div className="settings-modal-actions">
          <button
            type="button"
            className="settings-pill"
            onClick={() => preferencesStore.getState().setDefaultModel(undefined)}
          >
            {t("core.settings.defaults.reset_model")}
          </button>
        </div>
      )}
    </div>
  );
}
