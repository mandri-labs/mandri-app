import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Plug, ShieldCheck } from "lucide-react";
import { IntegrationSelect } from "@/features/sessions/IntegrationSelect";
import "@/features/sessions/worktree-integration.css";
import "@/features/transcript/composer.css";
import { useTranslation } from "react-i18next";
import { useOverlayFocus } from "@/app/dialogFocus";
import { useStore } from "@/app/useStore";
import { DaemonError, daemonErrorKey } from "@/daemon/errors";
import { daemonIdentity } from "@/daemon/identity";
import { cancelChatGptLogin, startChatGptLogin, type ChatGptLogin } from "@/daemon/rest/chatgpt";
import { ChatGptConnection } from "./ChatGptConnection";
import { createProvider, updateProvider } from "@/daemon/rest/providers";
import {
  PROVIDER_KINDS,
  isHostedProviderKind,
  isLocalProviderKind,
  providersStore,
} from "@/stores/providers";
import type { ProviderKind, ProviderView } from "@/stores/providers";

export interface ProviderFormDialogProps {
  open: boolean;
  provider?: ProviderView;
  onSaved: () => void;
  onClose: () => void;
}

interface ProviderFormValues {
  name: string;
  kind: ProviderKind;
  apiBase: string;
  apiKey: string;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function ProviderFormDialog({ open, provider, onSaved, onClose }: ProviderFormDialogProps) {
  const { t } = useTranslation();
  const providers = useStore(providersStore, (state) => state.providers);
  const isEdit = provider !== undefined;
  const [login, setLogin] = useState<ChatGptLogin | null>(null);
  const alive = useRef(open);
  alive.current = open;
  const generation = useRef(daemonIdentity.getState().generation);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const close = () => {
    if (
      login?.status === "pending" &&
      generation.current === daemonIdentity.getState().generation
    ) {
      void cancelChatGptLogin(login.login_id).catch(() => undefined);
    }
    setLogin(null);
    onClose();
  };
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProviderFormValues>({
    defaultValues: {
      name: provider?.name ?? "",
      kind: (provider?.kind as ProviderKind) ?? "openrouter",
      apiBase: provider?.apiBase ?? "",
      apiKey: "",
    },
  });
  const kind = watch("kind");
  const providerRef = useRef(provider);
  providerRef.current = provider;
  useEffect(() => {
    if (!open) return;
    setLogin(null);
    generation.current = daemonIdentity.getState().generation;
    const current = providerRef.current;
    reset({
      name: current?.name ?? "",
      kind: (current?.kind as ProviderKind) ?? "openrouter",
      apiBase: current?.apiBase ?? "",
      apiKey: "",
    });
  }, [open, provider?.name, reset]);
  const localKind = isLocalProviderKind(kind);
  const hostedKind = isHostedProviderKind(kind);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(panelRef, open, close);

  const kindOptions = useMemo(
    () => PROVIDER_KINDS.map((value) => ({ value, label: t(`core.providers.kind.${value}`) })),
    [t],
  );

  if (!open) {
    return null;
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (values.kind === "chatgpt") {
        const session = await startChatGptLogin(
          values.name.trim(),
          values.apiBase.trim() || undefined,
        );
        if (!alive.current || generation.current !== daemonIdentity.getState().generation) {
          if (
            generation.current === daemonIdentity.getState().generation &&
            session.status === "pending"
          ) {
            void cancelChatGptLogin(session.login_id).catch(() => undefined);
          }
          return;
        }
        setLogin(session);
        return;
      }
      if (isEdit) {
        const row = await updateProvider(provider.name, {
          api_base: values.apiBase.trim().length > 0 ? values.apiBase.trim() : null,
          ...(values.apiKey.trim().length > 0 ? { api_key: values.apiKey.trim() } : {}),
        });
        providersStore.getState().upsertProvider(row);
      } else {
        const row = await createProvider({
          name: values.name.trim(),
          kind: values.kind,
          api_base: values.apiBase.trim().length > 0 ? values.apiBase.trim() : null,
          api_key: values.apiKey.trim(),
          verify: true,
        });
        providersStore.getState().upsertProvider(row);
      }
      reset();
      onSaved();
    } catch (error) {
      if (error instanceof DaemonError && error.code === "provider_exists") {
        setError("name", { type: "server", message: t("core.providers.form.name_exists") });
      } else {
        const reason =
          error instanceof DaemonError && error.code === "provider_verification_failed"
            ? error.detail.reason
            : undefined;
        setError("root", {
          type: "server",
          message: [t(daemonErrorKey(error)), typeof reason === "string" ? reason : undefined]
            .filter(Boolean)
            .join(" — "),
        });
      }
    }
  });

  return (
    <div className="providers-dialog-backdrop" role="presentation" onClick={close}>
      <div
        ref={panelRef}
        className={`providers-dialog${login ? " providers-dialog--oauth" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          login
            ? t("core.providers.oauth.title")
            : isEdit
              ? t("core.providers.form.edit_title")
              : t("core.providers.form.create_title")
        }
        onClick={(event) => event.stopPropagation()}
      >
        {login ? (
          <ChatGptConnection
            login={login}
            apiBase={watch("apiBase") || undefined}
            onChange={setLogin}
            onDone={onSaved}
            onClose={close}
          />
        ) : (
          <>
            <h2 className="providers-dialog-title">
              {isEdit ? t("core.providers.form.edit_title") : t("core.providers.form.create_title")}
            </h2>
            <form className="providers-form" onSubmit={onSubmit} noValidate>
              <label className="providers-field">
                <span className="providers-field-label">{t("core.providers.form.name")}</span>
                <input
                  type="text"
                  className="providers-input"
                  disabled={isEdit}
                  placeholder={t("core.providers.form.name_placeholder")}
                  {...register("name", {
                    required: t("core.providers.form.name_required"),
                    validate: (value) => {
                      const trimmed = value.trim();
                      if (trimmed.length === 0) {
                        return t("core.providers.form.name_required");
                      }
                      if (!isEdit && providers[trimmed] !== undefined) {
                        return t("core.providers.form.name_exists");
                      }
                      return true;
                    },
                  })}
                />
                {errors.name !== undefined && (
                  <span className="providers-field-error" role="alert">
                    {errors.name.message}
                  </span>
                )}
              </label>

              <IntegrationSelect
                label={t("core.providers.form.kind")}
                value={kind}
                options={kindOptions}
                disabled={isEdit}
                icon={<Plug size={16} aria-hidden="true" />}
                onChange={(value) => setValue("kind", value, { shouldDirty: true })}
              />

              {(localKind || (provider?.apiBase ?? "").length > 0) && (
                <label className="providers-field">
                  <span className="providers-field-label">{t("core.providers.form.api_base")}</span>
                  <input
                    type="url"
                    className="providers-input"
                    placeholder={t("core.providers.form.api_base_placeholder")}
                    {...register("apiBase", {
                      validate: (value) => {
                        const trimmed = value.trim();
                        if (!localKind) {
                          return true;
                        }
                        if (trimmed.length === 0) {
                          return t("core.providers.form.api_base_required");
                        }
                        if (!isValidUrl(trimmed)) {
                          return t("core.providers.form.api_base_invalid");
                        }
                        return true;
                      },
                    })}
                  />
                  {localKind && (
                    <span className="providers-field-hint">
                      {t("core.providers.form.api_base_hint")}
                    </span>
                  )}
                  {errors.apiBase !== undefined && (
                    <span className="providers-field-error" role="alert">
                      {errors.apiBase.message}
                    </span>
                  )}
                </label>
              )}

              {kind === "chatgpt" ? (
                <div className="chatgpt-connect-intro">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <div>
                    <strong>{t("core.providers.oauth.intro_title")}</strong>
                    <p>{t("core.providers.oauth.intro_body")}</p>
                  </div>
                </div>
              ) : (
                <label className="providers-field">
                  <span className="providers-field-label">
                    {hostedKind && !isEdit
                      ? t("core.providers.form.api_key_new")
                      : t("core.providers.form.api_key")}
                  </span>
                  <input
                    type="password"
                    className="providers-input"
                    autoComplete="off"
                    placeholder={isEdit ? t("core.providers.form.api_key_keep") : undefined}
                    {...register("apiKey", {
                      validate: (value) => {
                        if (hostedKind && !isEdit && value.trim().length === 0) {
                          return t("core.providers.form.api_key_required");
                        }
                        return true;
                      },
                    })}
                  />
                  {isEdit && hostedKind && (
                    <span className="providers-field-hint">
                      {t("core.providers.form.api_key_keep")}
                    </span>
                  )}
                  {errors.apiKey !== undefined && (
                    <span className="providers-field-error" role="alert">
                      {errors.apiKey.message}
                    </span>
                  )}
                </label>
              )}

              {errors.root !== undefined && (
                <div className="providers-form-error" role="alert">
                  {errors.root.message}
                </div>
              )}

              <div className="providers-dialog-actions">
                <button type="button" className="providers-button" onClick={close}>
                  {t("core.actions.cancel")}
                </button>
                <button
                  type="submit"
                  className="providers-button providers-button--primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? t("core.providers.form.saving")
                    : kind === "chatgpt"
                      ? t(`core.providers.oauth.${isEdit ? "reconnect" : "connect"}`)
                      : t("core.providers.form.save")}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
