import { ChipPopover } from "@/features/transcript/ChipPopover";
import { HarnessMark, harnessDisplayName } from "@/features/transcript/composerControls";
import { resolveDefaultHarness } from "@/features/sessions/defaultHarness";
import { sidebarPreferencesStore } from "@/stores/sidebarPreferences";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  ChevronDown,
  Languages,
  Plug,
  PlugZap,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { useOverlayFocus } from "@/app/dialogFocus";
import { ConnectionSettings } from "./ConnectionSettings";
import { DefaultModelSettings } from "./DefaultModelSettings";
import { useStore } from "@/app/useStore";
import { changeLocale } from "@/i18n";
import { preferencesStore } from "@/stores/preferences";
import { debugPreferencesStore } from "@/stores/debugPreferences";
import { displayPreferencesStore, type ConversationWidth } from "@/stores/displayPreferences";
import type { LanguageSetting, ThemeSetting } from "@/stores/preferences";
import { isTauri } from "@/lib/platform";
import { listRuntimes } from "@/daemon/rest/runtime";
import { daemonErrorKey } from "@/daemon/errors";
import { invalidateNativeModels } from "@/features/providers/nativeModels";
import { ProvidersPage } from "@/features/providers/ProvidersPage";
import { AntigravityLogo, ClaudeLogo, OpenAILogo, OpencodeLogo, PiLogo } from "@/design/logos";
import "./settings-modal.css";

const HARNESS_OPTIONS = ["claude", "codex", "opencode", "agy", "pi"] as const;

type DefaultHarness = (typeof HARNESS_OPTIONS)[number];

type RuntimeRow = Awaited<ReturnType<typeof listRuntimes>>[number];

export type SettingsSection =
  | "harnesses"
  | "providers"
  | "appearance"
  | "language"
  | "connection"
  | "notifications"
  | "defaults";

type HarnessStatus = "installed" | "degraded" | "missing" | "unknown";

function HarnessLogo({ harness }: { harness: DefaultHarness }) {
  if (harness === "pi") return <PiLogo size={20} />;
  if (harness === "agy") return <AntigravityLogo size={20} />;
  if (harness === "claude") {
    return <ClaudeLogo size={20} />;
  }
  if (harness === "codex") {
    return <OpenAILogo size={20} />;
  }
  return <OpencodeLogo size={20} />;
}

function HarnessList() {
  const { t } = useTranslation();
  const [runtimes, setRuntimes] = useState<RuntimeRow[] | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRuntimes()
      .then((rows) => {
        if (!cancelled) {
          setRuntimes(rows);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(daemonErrorKey(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const verify = (): void => {
    setChecking(true);
    setFailure(null);
    invalidateNativeModels();
    listRuntimes()
      .then((rows) => {
        setRuntimes(rows);
      })
      .catch((error: unknown) => {
        setFailure(daemonErrorKey(error));
        setRuntimes(undefined);
      })
      .finally(() => {
        setChecking(false);
      });
  };

  const statusOf = (harness: DefaultHarness): HarnessStatus => {
    const runtime = runtimes?.find((row) => row.harness === harness);
    if (runtime === undefined) {
      return runtimes === undefined ? "unknown" : "missing";
    }
    if (!runtime.installed) {
      return "missing";
    }
    return runtime.degraded ? "degraded" : "installed";
  };

  const statusLabel = (status: HarnessStatus): string => {
    if (status === "installed") {
      return t("core.settings.harnesses.installed");
    }
    if (status === "degraded") {
      return t("core.start.harness_degraded");
    }
    if (status === "missing") {
      return t("core.start.harness_not_installed");
    }
    return "—";
  };

  return (
    <div className="settings-modal-field">
      <p className="settings-harness-label">{t("core.settings.harnesses.connected_label")}</p>
      {failure && (
        <p className="providers-form-error" role="alert">
          {t(failure)}
        </p>
      )}
      <ul className="settings-harness-list">
        {HARNESS_OPTIONS.map((harness) => {
          const status = statusOf(harness);
          return (
            <li key={harness} className="settings-harness-row">
              <span className="settings-harness-logo" aria-hidden="true">
                <HarnessLogo harness={harness} />
              </span>
              <span className="settings-harness-info">
                <span className="settings-harness-name">
                  {t(`core.settings.defaults.harness_${harness}`)}
                </span>
                <span
                  className={`settings-harness-status${status === "degraded" ? " settings-harness-status--ember" : ""}`}
                >
                  {statusLabel(status)}
                </span>
              </span>
              <button type="button" className="settings-pill" disabled={checking} onClick={verify}>
                {t("core.settings.harnesses.verify")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <>
      <header className="settings-modal-header">
        <h2 className="settings-modal-section-title">{title}</h2>
        <p className="settings-modal-section-desc">{description}</p>
      </header>
      <div className="settings-modal-body">{children}</div>
    </>
  );
}

interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface RadioGroupProps<T extends string> {
  name: string;
  legend: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
}

function RadioGroup<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: RadioGroupProps<T>) {
  return (
    <div className="settings-modal-field">
      <p className="settings-modal-field-label">{legend}</p>
      <div className="settings-modal-option-group" role="radiogroup" aria-label={legend}>
        {options.map((option) => (
          <label key={option.value} className="settings-modal-option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="settings-modal-option">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function HarnessesSection() {
  const { t } = useTranslation();
  return (
    <Section
      title={t("core.settings.harnesses.title")}
      description={t("core.settings.harnesses.description")}
    >
      <HarnessList />
    </Section>
  );
}

function ProvidersSection() {
  const { t } = useTranslation();
  return (
    <Section
      title={t("core.settings.nav.providers")}
      description={t("core.settings.providers.description")}
    >
      <div className="settings-modal-providers">
        <ProvidersPage />
      </div>
    </Section>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const conversationWidth = useStore(displayPreferencesStore, (state) => state.conversationWidth);
  const theme = useStore(preferencesStore, (state) => state.theme);
  const hideTemporaryFolders = useStore(
    sidebarPreferencesStore,
    (state) => state.hideTemporaryFolders,
  );
  const showTechnicalEvents = useStore(debugPreferencesStore, (state) => state.showTechnicalEvents);
  return (
    <Section
      title={t("core.settings.appearance.title")}
      description={t("core.settings.appearance.description")}
    >
      <RadioGroup<ThemeSetting>
        name="settings-theme"
        legend={t("core.settings.appearance.theme")}
        value={theme}
        options={[
          { value: "dark", label: t("core.settings.appearance.theme_dark") },
          { value: "light", label: t("core.settings.appearance.theme_light") },
        ]}
        onChange={(next) => preferencesStore.getState().setTheme(next)}
      />
      <RadioGroup<ConversationWidth>
        name="settings-conversation-width"
        legend={t("core.settings.appearance.conversation_width")}
        value={conversationWidth}
        options={[
          { value: "standard", label: t("core.settings.appearance.width_standard") },
          { value: "wide", label: t("core.settings.appearance.width_wide") },
          { value: "full", label: t("core.settings.appearance.width_full") },
        ]}
        onChange={(next) => displayPreferencesStore.getState().setConversationWidth(next)}
      />
      <Toggle
        label={t("core.settings.appearance.hide_temporary_folders")}
        checked={hideTemporaryFolders}
        onChange={(value) => sidebarPreferencesStore.getState().setHideTemporaryFolders(value)}
      />
      <Toggle
        label={t("core.settings.appearance.technical_events")}
        checked={showTechnicalEvents}
        onChange={(value) => debugPreferencesStore.getState().setShowTechnicalEvents(value)}
      />
    </Section>
  );
}

function LanguageSection() {
  const { t } = useTranslation();
  const language = useStore(preferencesStore, (state) => state.language);
  const resolved = useStore(preferencesStore, (state) => state.resolvedLanguage);
  const resolvedLabel = t(`core.settings.language.${resolved}`);
  return (
    <Section
      title={t("core.settings.language.title")}
      description={t("core.settings.language.description")}
    >
      <RadioGroup<LanguageSetting>
        name="settings-language"
        legend={t("core.settings.language.title")}
        value={language}
        options={[
          { value: "fr", label: t("core.settings.language.fr") },
          { value: "en", label: t("core.settings.language.en") },
          { value: "auto", label: t("core.settings.language.auto") },
        ]}
        onChange={(next) => {
          preferencesStore.getState().setLanguage(next);
          void changeLocale(preferencesStore.getState().resolvedLanguage);
        }}
      />
      {language === "auto" && (
        <p className="settings-modal-hint">
          {t("core.settings.language.auto_resolved", { language: resolvedLabel })}
        </p>
      )}
    </Section>
  );
}

function ConnectionSection() {
  const { t } = useTranslation();
  return (
    <Section
      title={t("core.settings.nav.connection")}
      description={t("core.settings.connection.description")}
    >
      <ConnectionSettings />
    </Section>
  );
}

function NotificationsSection() {
  const { t } = useTranslation();
  const approvals = useStore(preferencesStore, (state) => state.approvalNotifications);
  const closeToTray = useStore(preferencesStore, (state) => state.closeToTray);
  return (
    <Section
      title={t("core.settings.notifications.title")}
      description={t("core.settings.notifications.description")}
    >
      <Toggle
        label={t("core.settings.notifications.approvals")}
        checked={approvals}
        onChange={(next) => preferencesStore.getState().setApprovalNotifications(next)}
      />
      {isTauri() && (
        <Toggle
          label={t("core.settings.notifications.close_to_tray")}
          checked={closeToTray}
          onChange={(next) => preferencesStore.getState().setCloseToTray(next)}
        />
      )}
    </Section>
  );
}

function DefaultsSection() {
  const { t } = useTranslation();
  const harness = useStore(preferencesStore, (state) => state.defaultHarness);
  const [runtimes, setRuntimes] = useState<RuntimeRow[]>([]);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    listRuntimes()
      .then((rows) => {
        if (!cancelled) setRuntimes(rows);
      })
      .catch(() => {
        /* Keep the saved preference visible while offline. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const effectiveHarness = resolveDefaultHarness(runtimes, harness) || harness || "";
  return (
    <Section
      title={t("core.settings.defaults.title")}
      description={t("core.settings.defaults.description")}
    >
      <div className="settings-modal-field">
        <label className="settings-modal-field-label" htmlFor="settings-default-harness">
          {t("core.settings.defaults.harness")}
        </label>
        <div ref={anchor} className="settings-model-anchor">
          <button
            id="settings-default-harness"
            type="button"
            className="settings-modal-input settings-model-trigger settings-harness-trigger"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={t("core.settings.defaults.harness")}
            onClick={() => setOpen(!open)}
          >
            <HarnessMark harness={effectiveHarness} size={18} />
            <span className="welcome-menu-row-label">
              {effectiveHarness
                ? harnessDisplayName(effectiveHarness, t)
                : t("core.start.harness_choose")}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {open && (
            <ChipPopover
              anchorRef={anchor}
              placement="bottom"
              align="start"
              className="chip-popover--harness"
              onClose={() => setOpen(false)}
            >
              <div className="welcome-menu">
                {HARNESS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`welcome-menu-row${option === effectiveHarness ? " welcome-menu-row--active" : ""}`}
                    aria-pressed={option === effectiveHarness}
                    onClick={() => {
                      preferencesStore.getState().setDefaultHarness(option);
                      setOpen(false);
                    }}
                  >
                    <HarnessMark harness={option} size={18} />
                    <span className="welcome-menu-row-label">{harnessDisplayName(option, t)}</span>
                  </button>
                ))}
              </div>
            </ChipPopover>
          )}
        </div>
      </div>
      <DefaultModelSettings harness={effectiveHarness} />
    </Section>
  );
}

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
}

export function SettingsModal({ open, onClose, initialSection = "harnesses" }: SettingsModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  useOverlayFocus(panelRef, open, onClose);

  if (!open) {
    return null;
  }

  const navItems: { id: SettingsSection; labelKey: string; Icon: typeof Plug }[] = [
    { id: "harnesses", labelKey: "core.settings.nav.harnesses", Icon: Plug },
    { id: "providers", labelKey: "core.settings.nav.providers", Icon: SettingsIcon },
    { id: "appearance", labelKey: "core.settings.nav.appearance", Icon: Sun },
    { id: "language", labelKey: "core.settings.nav.language", Icon: Languages },
    { id: "connection", labelKey: "core.settings.nav.connection", Icon: PlugZap },
    { id: "notifications", labelKey: "core.settings.nav.notifications", Icon: Bell },
    { id: "defaults", labelKey: "core.settings.nav.defaults", Icon: SlidersHorizontal },
  ];

  return (
    <div
      className="settings-modal-overlay"
      role="presentation"
      onClick={() => {
        onClose();
      }}
    >
      <div
        ref={panelRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("core.settings.title")}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <aside className="settings-modal-nav">
          <div className="settings-modal-nav-head">
            <h2 className="settings-modal-title">{t("core.settings.title")}</h2>
            <button
              type="button"
              className="settings-modal-close"
              aria-label={t("core.actions.close")}
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <nav className="settings-modal-items" aria-label={t("core.settings.title")}>
            {navItems.map(({ id, labelKey, Icon }) => (
              <button
                key={id}
                type="button"
                className={`settings-modal-item${section === id ? " settings-modal-item--active" : ""}`}
                aria-current={section === id ? "true" : undefined}
                onClick={() => {
                  setSection(id);
                }}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-modal-content">
          {section === "harnesses" && <HarnessesSection />}
          {section === "providers" && <ProvidersSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "language" && <LanguageSection />}
          {section === "connection" && <ConnectionSection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "defaults" && <DefaultsSection />}
        </div>
      </div>
    </div>
  );
}
