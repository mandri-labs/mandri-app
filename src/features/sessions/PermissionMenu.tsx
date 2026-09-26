import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HarnessKind } from "@/daemon/types/ws";
import { harnessDisplayName } from "@/features/transcript/composerControls";
import { HARNESS_MODES, permissionLabel, permissionTone } from "./permissionModes";
import "./permissions.css";

export function PermissionMenu({
  harness,
  selected,
  modes,
  unavailable,
  onSelect,
  indicatorSide = "left",
}: {
  harness: HarnessKind;
  selected: string;
  modes?: readonly string[];
  unavailable?: Record<string, string | undefined>;
  onSelect: (mode: string) => void;
  indicatorSide?: "left" | "right";
}) {
  const { t } = useTranslation();
  return (
    <div className="permission-menu" role="group" aria-label={t("core.start.mode")}>
      <div className="settings-menu-heading">
        {t("core.protection.harness_settings", { harness: harnessDisplayName(harness, t) })}
      </div>
      {(modes ?? HARNESS_MODES[harness]).map((mode) => (
        <button
          type="button"
          key={mode}
          className={`permission-option${indicatorSide === "left" ? " permission-option--check-left" : ""}`}
          data-setting-tone={permissionTone(harness, mode)}
          aria-pressed={selected === mode}
          disabled={!!unavailable?.[mode]}
          onClick={() => onSelect(mode)}
        >
          <span>
            <span className="permission-option-label">{permissionLabel(harness, mode, t)}</span>
            <span className="permission-option-description">
              {unavailable?.[mode]
                ? t(`error.${unavailable[mode]}`)
                : t(`core.permissions.${harness}.${mode}.description`)}
            </span>
          </span>
          <Check
            size={16}
            aria-hidden="true"
            className={selected === mode ? "" : "permission-check--hidden"}
          />
        </button>
      ))}
    </div>
  );
}
