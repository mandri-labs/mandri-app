import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NativeCommand } from "@/daemon/types/commands";
import "./permissions.css";
import "./protection.css";

export function OpenCodeAgentMenu({
  agents,
  selected,
  automatic,
  pending,
  loading,
  failed,
  onSelect,
  onAutomatic,
  onRefresh,
}: {
  agents: readonly NativeCommand[];
  selected?: string;
  automatic: boolean;
  pending: boolean;
  loading: boolean;
  failed: boolean;
  onSelect: (agent: string) => void;
  onAutomatic: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="permission-menu" role="group" aria-label={t("core.composer.native_agents")}>
      <div className="settings-menu-heading">{t("core.composer.native_agents")}</div>
      {agents.map((agent) => (
        <button
          type="button"
          key={agent.id}
          className="permission-option permission-option--check-left"
          aria-pressed={selected === agent.id.slice(6)}
          disabled={pending}
          onClick={() => onSelect(agent.id.slice(6))}
        >
          <span>
            <span className="permission-option-label">{agent.name}</span>
            {agent.description && (
              <span className="permission-option-description">{agent.description}</span>
            )}
          </span>
          <Check
            size={16}
            aria-hidden="true"
            className={selected === agent.id.slice(6) ? "" : "permission-check--hidden"}
          />
        </button>
      ))}
      {loading && (
        <div className="settings-menu-heading" role="status">
          {t("commands.loading")}
        </div>
      )}
      {(failed || (!loading && !agents.length)) && (
        <button type="button" className="permission-option" onClick={onRefresh}>
          {t("commands.retry")}
        </button>
      )}
      <button
        type="button"
        className="permission-option"
        role="switch"
        aria-checked={automatic}
        disabled={pending}
        onClick={() => onAutomatic(!automatic)}
      >
        <span>
          <span className="permission-option-label">
            {t("core.permissions.opencode.auto.label")}
          </span>
          <span className="permission-option-description">
            {t("core.permissions.opencode.auto.description")}
          </span>
        </span>
        <span
          className={`execution-switch${automatic ? " execution-switch--on" : ""}`}
          aria-hidden="true"
        >
          <span />
        </span>
      </button>
    </div>
  );
}
