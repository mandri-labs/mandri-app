import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useStore } from "@/app/useStore";
import { navigate } from "@/app/useHashRoute";
import { daemonIdentity } from "@/daemon/identity";
import { eraseSessionUsage } from "@/daemon/rest/usage";
import type { UsageGroup, UsageScope } from "@/daemon/rest/usage";
import { connectionStore } from "@/stores/connection";
import { createUsageStore } from "@/stores/usage";
import { useUsageInvalidation } from "./useUsageInvalidation";
import { Consumption } from "./Consumption";
import { AccountCard } from "./AccountCard";
export { formatUsageNumber, formatUsageUsd } from "./format";
import "./usage.css";

function EraseUsage({
  sessionId,
  onErased,
  online,
}: {
  sessionId: string;
  onErased: () => void;
  online: boolean;
}) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [erased, setErased] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const erase = async () => {
    if (!confirmed || busy || !online) return;
    const controller = new AbortController();
    pending.current = controller;
    const generation = daemonIdentity.getState().generation;
    setBusy(true);
    setError(null);
    try {
      await eraseSessionUsage(sessionId, controller.signal);
      if (!controller.signal.aborted && generation === daemonIdentity.getState().generation) {
        setErased(true);
        setConfirmed(false);
        onErased();
      }
    } catch (caught) {
      if (!controller.signal.aborted && generation === daemonIdentity.getState().generation)
        setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (!controller.signal.aborted && generation === daemonIdentity.getState().generation)
        setBusy(false);
    }
  };
  return (
    <details className="usage-disclosure">
      <summary>{t("usage.erase_title")}</summary>
      <p>{t("usage.erase_note")}</p>
      <label className="usage-checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {t("usage.erase_confirm")}
      </label>
      <p>
        <button
          type="button"
          className="usage-button usage-button--danger"
          disabled={!confirmed || busy || !online}
          onClick={() => void erase()}
        >
          {t("usage.erase_title")}
        </button>
      </p>
      {error && <p role="alert">{error}</p>}
      {erased && <p role="status">{t("usage.erased")}</p>}
    </details>
  );
}

export function UsagePage({
  sessionId,
  projectPath,
}: {
  sessionId?: string;
  projectPath?: string;
}) {
  const { t, i18n } = useTranslation();
  const [controller] = useState(createUsageStore);
  useUsageInvalidation(controller.invalidate);
  const state = useStore(controller.store, (value) => value);
  const endpoint = useStore(daemonIdentity, (value) => value.baseUrl);
  const generation = useStore(daemonIdentity, (value) => value.generation);
  const status = useStore(connectionStore, (value) => value.status);
  const [tab, setTab] = useState<"consumption" | "accounts">("consumption");
  const [period, setPeriod] = useState<"last30d" | "lifetime">(sessionId ? "lifetime" : "last30d");
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [groupBy, setGroupBy] = useState<UsageGroup>("model");
  const [scopeKind, setScopeKind] = useState<UsageScope["kind"]>(
    sessionId ? "session" : projectPath ? "project" : "global",
  );
  const [scopeId, setScopeId] = useState(sessionId ?? projectPath ?? "");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const query = useMemo(
    () => ({
      scope: sessionId
        ? { kind: "session" as const, id: sessionId }
        : projectPath
          ? { kind: "project" as const, id: projectPath }
          : { kind: "global" as const },
      period,
      includeDeleted,
      includeDescendants,
      groupBy,
      timezone,
    }),
    [sessionId, projectPath, period, includeDeleted, includeDescendants, groupBy, timezone],
  );
  useEffect(() => controller.mount(query, tab), [controller, query, tab]);
  const asOf = tab === "consumption" ? state.overview?.as_of : state.accounts?.as_of;
  return (
    <main className="usage-page">
      <header className="usage-heading usage-page-header">
        <div>
          <h1>{t("usage.title")}</h1>
          <p className="usage-note">{t("usage.subtitle")}</p>
          {(sessionId || projectPath) && (
            <p className="usage-note usage-source">
              {t(sessionId ? "usage.session" : "usage.project")}: {sessionId ?? projectPath}
            </p>
          )}
        </div>
        <button
          type="button"
          className="usage-button"
          disabled={status !== "online" || state.refreshing}
          aria-busy={state.refreshing}
          onClick={() => void controller.refresh()}
        >
          {state.refreshing ? (
            <LoaderCircle className="usage-refresh-spinner" size={14} aria-hidden="true" />
          ) : (
            <RefreshCw size={14} aria-hidden="true" />
          )}
          {t(state.refreshing ? "usage.refreshing" : "usage.refresh")}
        </button>
      </header>
      <div className="usage-tabs" role="group" aria-label={t("usage.views")}>
        <button
          type="button"
          aria-pressed={tab === "consumption"}
          onClick={() => setTab("consumption")}
        >
          {t("usage.consumption")}
        </button>
        <button type="button" aria-pressed={tab === "accounts"} onClick={() => setTab("accounts")}>
          {t("usage.accounts")}
        </button>
      </div>
      {status !== "online" && (
        <p role="status" className="usage-notice">
          {t("usage.offline")}
        </p>
      )}
      {state.error && (
        <div role="alert" className="usage-notice usage-notice--error">
          <p>
            {t("usage.error")} {state.error}
          </p>
          <button
            className="usage-button"
            type="button"
            disabled={status !== "online"}
            onClick={controller.reload}
          >
            {t("usage.retry")}
          </button>
        </div>
      )}
      {state.refreshStatus && (
        <p role="status" className="usage-note">
          {t(`usage.states.${state.refreshStatus}`, { defaultValue: state.refreshStatus })}
        </p>
      )}
      {tab === "consumption" ? (
        <>
          <div className="usage-toolbar">
            <form
              className="usage-scope-form"
              onSubmit={(event) => {
                event.preventDefault();
                navigate(
                  scopeKind === "session"
                    ? { name: "usage", sessionId: scopeId.trim() }
                    : scopeKind === "project"
                      ? { name: "usage", projectPath: scopeId.trim() }
                      : { name: "usage" },
                );
              }}
            >
              <label className="usage-field">
                {t("usage.scope")}
                <select
                  value={scopeKind}
                  onChange={(event) => {
                    setScopeKind(event.target.value as UsageScope["kind"]);
                    setScopeId("");
                  }}
                >
                  <option value="global">{t("usage.global")}</option>
                  <option value="project">{t("usage.project")}</option>
                  <option value="session">{t("usage.session")}</option>
                </select>
              </label>
              {scopeKind !== "global" && (
                <label className="usage-field usage-scope-id">
                  {t(scopeKind === "project" ? "usage.project_path" : "usage.session_id")}
                  <input
                    required
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                  />
                </label>
              )}
              {(scopeKind !== query.scope.kind ||
                (query.scope.kind !== "global" && scopeId !== query.scope.id)) && (
                <button className="usage-button usage-button--primary" type="submit">
                  {t("usage.apply")}
                </button>
              )}
            </form>
            <label className="usage-field">
              {t("usage.period")}
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as typeof period)}
              >
                <option value="last30d">{t("usage.last30d")}</option>
                <option value="lifetime">{t("usage.lifetime")}</option>
              </select>
            </label>
          </div>
          <div className="usage-filters usage-filter-options">
            <label className="usage-checkbox">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(event) => setIncludeDeleted(event.target.checked)}
              />
              {t("usage.include_deleted")}
            </label>
            {sessionId && (
              <label className="usage-checkbox">
                <input
                  type="checkbox"
                  checked={includeDescendants}
                  onChange={(event) => setIncludeDescendants(event.target.checked)}
                />
                {t("usage.include_descendants")}
              </label>
            )}
          </div>
          {sessionId && (
            <p className="usage-note">
              {t(includeDescendants ? "usage.descendants_note" : "usage.direct_note")}
            </p>
          )}
          {state.loading && !state.overview && (
            <p role="status" className="usage-note">
              {t("usage.loading")}
            </p>
          )}
          {state.loading && !state.overview && (
            <div className="usage-skeleton" aria-hidden="true">
              <div />
              <div />
              <div />
              <div />
              <div />
            </div>
          )}
          {state.overview && (
            <div
              className="usage-results"
              aria-busy={state.updating}
              data-changing-inclusion={state.changingInclusion}
            >
              <Consumption
                data={state.overview}
                group={groupBy}
                displayedGroup={state.overviewGroup}
                onGroupChange={setGroupBy}
              />
            </div>
          )}
          {sessionId && (
            <EraseUsage
              key={`${generation}-${sessionId}`}
              sessionId={sessionId}
              online={status === "online"}
              onErased={controller.reload}
            />
          )}
        </>
      ) : (
        <section className="usage-accounts">
          {state.loading && !state.accounts && <p role="status">{t("usage.loading")}</p>}
          {state.accounts?.accounts.length === 0 && (
            <p className="usage-notice">{t("usage.no_accounts")}</p>
          )}
          <div className="usage-account-grid">
            {state.accounts?.accounts.map((account) => (
              <AccountCard key={`${account.harness}-${account.account_id}`} account={account} />
            ))}
          </div>
        </section>
      )}
      <footer className="usage-footer">
        <details className="usage-disclosure">
          <summary>{t("usage.diagnostics")}</summary>
          <p className="usage-note">{t("usage.collection_note")}</p>
          <p className="usage-note">
            {endpoint} ({sessionId ?? projectPath ?? t("usage.global")})
          </p>
          <p className="usage-note">
            {t("usage.revision")}:{" "}
            {tab === "consumption" ? state.overview?.revision : state.accounts?.revision}
          </p>
          {state.overview?.last_observed_at != null && (
            <p className="usage-note">
              {t("usage.last_observed", {
                date: new Date(state.overview.last_observed_at).toLocaleString(i18n.language),
              })}
            </p>
          )}
          {state.capabilityError && (
            <p role="alert">
              {t("usage.capabilities_error")} {state.capabilityError}
            </p>
          )}
          {state.capabilities?.capabilities.map((capability) => (
            <div className="usage-capability" key={capability.harness}>
              <strong>{capability.harness}</strong>
              <span>
                {t("usage.live")}:{" "}
                {t(`usage.states.${capability.live}`, { defaultValue: String(capability.live) })}
              </span>
              <span>
                {t("usage.history")}:{" "}
                {t(`usage.states.${capability.history}`, {
                  defaultValue: String(capability.history),
                })}
              </span>
              <span>
                {t("usage.accounts")}:{" "}
                {t(`usage.states.${capability.quotas}`, {
                  defaultValue: String(capability.quotas),
                })}
              </span>
              {capability.detail && <p className="usage-note">{capability.detail}</p>}
            </div>
          ))}
        </details>
        {asOf != null && (
          <p className="usage-note">
            {t("usage.as_of", { date: new Date(asOf).toLocaleString(i18n.language) })}
          </p>
        )}
        {tab === "accounts" && <p className="usage-note">{t("usage.account_scope")}</p>}
      </footer>
    </main>
  );
}
