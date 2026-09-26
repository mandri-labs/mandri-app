import { Box, Check, Container, GitBranch, Info, ShieldCheck } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { choicePolicy, type ProtectionChoice } from "@/daemon/protection";
import "./permissions.css";
import "./protection.css";

export function ProtectionMenu({
  value,
  onSelect,
  disabled = false,
  worktreeId = "",
  onWorktreeIdChange,
  onPrivacyInfo,
}: {
  value: ProtectionChoice;
  onSelect: (choice: ProtectionChoice) => void;
  disabled?: boolean;
  worktreeId?: string;
  onWorktreeIdChange?: (value: string) => void;
  onPrivacyInfo?: () => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const policy = choicePolicy(value);
  const surrogate = policy.privacy_mode === "surrogate";
  const environment = policy.worktree
    ? "worktree"
    : policy.execution_backend === "docker"
      ? "docker"
      : "standard";
  const select = (next: "standard" | "docker" | "worktree", privacy = surrogate) => {
    onSelect(
      next === "worktree"
        ? privacy
          ? "worktree_surrogate"
          : "worktree"
        : next === "docker"
          ? privacy
            ? "paranoid"
            : "docker"
          : privacy
            ? "surrogate"
            : "standard",
    );
  };
  return (
    <div
      className="permission-menu execution-menu"
      role="group"
      aria-label={t("core.protection.label")}
    >
      <div className="settings-menu-heading">{t("core.protection.execution_context")}</div>
      {(["standard", "docker", "worktree"] as const).map((choice) => {
        const Icon = choice === "docker" ? Container : choice === "worktree" ? GitBranch : Box;
        return (
          <button
            key={choice}
            type="button"
            className="permission-option execution-option"
            aria-pressed={environment === choice}
            disabled={disabled}
            onClick={() => select(choice)}
          >
            <Icon size={17} aria-hidden="true" />
            <span className="execution-option-copy">
              <span className="permission-option-label">{t(`core.protection.${choice}`)}</span>
              <span className="permission-option-description">
                {t(`core.protection.${choice}_description`)}
              </span>
            </span>
            <Check
              size={16}
              aria-hidden="true"
              className={environment === choice ? "" : "permission-check--hidden"}
            />
          </button>
        );
      })}
      {environment === "worktree" && onWorktreeIdChange ? (
        <div className="worktree-name-field">
          <label htmlFor={inputId}>{t("core.protection.worktree_name")}</label>
          <input
            id={inputId}
            type="text"
            value={worktreeId}
            maxLength={100}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("core.protection.worktree_random")}
            aria-describedby={`${inputId}-hint`}
            disabled={disabled}
            onChange={(event) => onWorktreeIdChange(event.target.value)}
          />
          <p id={`${inputId}-hint`}>{t("core.protection.worktree_name_hint")}</p>
        </div>
      ) : null}
      <div className={`execution-privacy${onPrivacyInfo ? " execution-privacy--with-info" : ""}`}>
        <button
          type="button"
          role="switch"
          aria-checked={surrogate}
          className="permission-option execution-option"
          disabled={disabled}
          onClick={() => select(environment, !surrogate)}
        >
          <ShieldCheck size={17} aria-hidden="true" />
          <span className="execution-option-copy">
            <span className="permission-option-label">{t("core.protection.surrogate")}</span>
            <span className="permission-option-description">
              {t("core.protection.surrogate_description")}
            </span>
          </span>
          <span
            className={`execution-switch${surrogate ? " execution-switch--on" : ""}`}
            aria-hidden="true"
          >
            <span />
          </span>
        </button>
        {onPrivacyInfo ? (
          <button
            type="button"
            className="execution-privacy-info"
            aria-label={t("core.protection.inventory_open")}
            aria-haspopup="dialog"
            title={t("core.protection.inventory_open")}
            onClick={onPrivacyInfo}
          >
            <Info size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
