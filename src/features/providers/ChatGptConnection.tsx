import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { daemonIdentity } from "@/daemon/identity";
import { daemonErrorKey } from "@/daemon/errors";
import {
  getChatGptLogin,
  startChatGptLogin,
  submitChatGptRedirect,
  type ChatGptLogin,
} from "@/daemon/rest/chatgpt";
import { listProviders } from "@/daemon/rest/providers";
import { openAuthorizationUrl } from "@/lib/platform/externalUrl";
import { providersStore } from "@/stores/providers";
import "./chatgpt.css";

interface Props {
  login: ChatGptLogin;
  apiBase?: string;
  onChange: (login: ChatGptLogin) => void;
  onDone: () => void;
  onClose: () => void;
}

export function ChatGptConnection({ login, apiBase, onChange, onDone, onClose }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [redirect, setRedirect] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(daemonIdentity.getState().generation);
  const pending = login.status === "pending";
  const completed = login.status === "completed";
  const failed = login.status === "failed" || login.status === "cancelled";
  const active = () =>
    mounted.current && generation.current === daemonIdentity.getState().generation;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [login.status]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (generation.current !== daemonIdentity.getState().generation) return;
      try {
        const updated = await getChatGptLogin(login.login_id, { signal: controller.signal });
        if (
          controller.signal.aborted ||
          generation.current !== daemonIdentity.getState().generation
        )
          return;
        setError(null);
        onChange(updated);
        if (updated.status !== "pending") return;
      } catch (failure) {
        if (
          controller.signal.aborted ||
          generation.current !== daemonIdentity.getState().generation
        )
          return;
        setError(daemonErrorKey(failure));
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500);
    }
    if (pending) timer = setTimeout(() => void poll(), 750);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [login.login_id, pending, onChange]);

  useEffect(() => {
    if (!completed) return;
    const controller = new AbortController();
    listProviders({ signal: controller.signal })
      .then((rows) => {
        if (
          controller.signal.aborted ||
          generation.current !== daemonIdentity.getState().generation
        )
          return;
        providersStore.getState().hydrateProviders(rows);
        providersStore.getState().resetCatalog(login.provider_name);
        setLoaded(true);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(daemonErrorKey(failure));
      });
    return () => controller.abort();
  }, [completed, login.provider_name, refresh]);

  async function openBrowser() {
    if (!login.authorize_url) return;
    try {
      await openAuthorizationUrl(login.authorize_url);
      if (active()) {
        setOpened(true);
        setError(null);
      }
    } catch {
      if (active()) setError("core.providers.oauth.browser_failed");
    }
  }

  async function copyLink() {
    if (!login.authorize_url) return;
    try {
      await navigator.clipboard.writeText(login.authorize_url);
      if (active()) setCopied(true);
    } catch {
      if (active()) setError("core.providers.oauth.copy_failed");
    }
  }

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const next = await startChatGptLogin(login.provider_name, apiBase);
      if (active()) {
        onChange(next);
        setOpened(false);
        setCopied(false);
        setRedirect("");
      }
    } catch (failure) {
      if (active()) setError(daemonErrorKey(failure));
    } finally {
      if (active()) setBusy(false);
    }
  }

  async function submitRedirect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await submitChatGptRedirect(login.login_id, redirect.trim());
      if (active()) {
        onChange(next);
        setRedirect("");
      }
    } catch (failure) {
      if (active()) setError(daemonErrorKey(failure));
    } finally {
      if (active()) setBusy(false);
    }
  }

  const errorCode = login.error_code;
  const failureKey =
    errorCode === "chatgpt_login_timeout"
      ? "timeout"
      : errorCode === "chatgpt_callback_unavailable"
        ? "listener_failed"
        : errorCode === "chatgpt_callback_rejected" || errorCode === "chatgpt_state_mismatch"
          ? "callback_failed"
          : "failed";

  return (
    <div className="chatgpt-connect">
      <div
        className={`chatgpt-connect-emblem ${failed ? "chatgpt-connect-emblem--error" : ""}`}
        aria-hidden="true"
      >
        {completed ? (
          <CheckCircle2 size={28} />
        ) : failed ? (
          <TriangleAlert size={28} />
        ) : (
          <ShieldCheck size={28} />
        )}
      </div>
      <div className="chatgpt-connect-heading">
        <span className="chatgpt-connect-eyebrow">{t("core.providers.kind.chatgpt")}</span>
        <h2
          ref={heading}
          tabIndex={-1}
          className="providers-dialog-title"
          id="chatgpt-connect-title"
        >
          {t(
            `core.providers.oauth.${completed ? "success_title" : failed ? "failed_title" : "title"}`,
          )}
        </h2>
        <p>
          {t(`core.providers.oauth.${completed ? "success_body" : failed ? failureKey : "body"}`, {
            name: login.provider_name,
          })}
        </p>
        <span className="chatgpt-connect-account">{login.provider_name}</span>
      </div>
      {pending && (
        <>
          <ol className="chatgpt-connect-steps" aria-label={t("core.providers.oauth.steps")}>
            <li data-active={!opened}>
              <span>{opened ? <Check size={13} /> : "1"}</span>
              {t("core.providers.oauth.step_browser")}
            </li>
            <li data-active={opened}>
              <span>2</span>
              {t("core.providers.oauth.step_authorize")}
            </li>
            <li>
              <span>3</span>
              {t("core.providers.oauth.step_ready")}
            </li>
          </ol>
          <div className="chatgpt-connect-browser">
            <button
              type="button"
              className="providers-button providers-button--primary"
              onClick={() => void openBrowser()}
              disabled={!login.authorize_url}
            >
              <ExternalLink size={15} aria-hidden="true" />
              {t(`core.providers.oauth.${opened ? "reopen" : "open"}`)}
            </button>
            <button
              type="button"
              className="providers-button"
              onClick={() => void copyLink()}
              disabled={!login.authorize_url}
            >
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
              {t(`core.providers.oauth.${copied ? "copied" : "copy"}`)}
            </button>
          </div>
          <div className="chatgpt-connect-wait" role="status">
            <LoaderCircle size={15} aria-hidden="true" />
            <span>{t("core.providers.oauth.waiting")}</span>
          </div>
          <details className="chatgpt-connect-manual">
            <summary>{t("core.providers.oauth.manual_title")}</summary>
            <p>{t("core.providers.oauth.manual_body")}</p>
            <form onSubmit={(event) => void submitRedirect(event)}>
              <label className="providers-field">
                <span className="providers-field-label">
                  {t("core.providers.oauth.redirect_label")}
                </span>
                <input
                  className="providers-input"
                  type="url"
                  value={redirect}
                  onChange={(event) => setRedirect(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="http://localhost:1455/auth/callback?…"
                  required
                />
              </label>
              <button
                className="providers-button"
                type="submit"
                disabled={busy || !redirect.trim()}
              >
                {t(`core.providers.oauth.${busy ? "checking" : "complete"}`)}
              </button>
            </form>
            {login.authorize_url && (
              <label className="providers-field">
                <span className="providers-field-label">
                  {t("core.providers.oauth.link_label")}
                </span>
                <input
                  className="providers-input"
                  readOnly
                  value={login.authorize_url}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            )}
          </details>
        </>
      )}
      {(error || (pending && login.error_code)) && (
        <div className="providers-form-error" role="alert">
          {t(error ?? `core.providers.oauth.${failureKey}`)}
        </div>
      )}
      {completed && !loaded && (
        <button
          type="button"
          className="providers-button"
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t("core.providers.oauth.refresh")}
        </button>
      )}
      <div className="chatgpt-connect-footer">
        <span>{t("core.providers.oauth.private")}</span>
        <div className="providers-dialog-actions">
          {!completed && (
            <button type="button" className="providers-button" onClick={onClose}>
              {t("core.actions.cancel")}
            </button>
          )}
          {failed && (
            <button
              type="button"
              className="providers-button providers-button--primary"
              disabled={busy}
              onClick={() => void retry()}
            >
              {t("core.actions.retry")}
            </button>
          )}
          {completed && (
            <button
              type="button"
              className="providers-button providers-button--primary"
              disabled={!loaded}
              onClick={onDone}
            >
              {t("core.providers.oauth.done")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
