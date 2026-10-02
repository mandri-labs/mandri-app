import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GitMerge, GitBranch, Maximize2, Minimize2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOverlayFocus } from "@/app/dialogFocus";
import { navigate } from "@/app/useHashRoute";
import { requestFocusComposer } from "@/app/keyboard";
import { sessionsStore, type SessionView } from "@/stores/sessions";
import { getSession } from "@/daemon/rest/sessions";
import { DaemonError } from "@/daemon/errors";
import {
  previewIntegration,
  integrateWorktree,
  finishWorktree,
  resolveWorktree,
  type IntegrationPreview,
  type IntegrationStrategy,
} from "@/daemon/rest/worktrees";
import { errorKey } from "./lifecycle";
import { IntegrationSelect } from "./IntegrationSelect";
import { WorktreeDiff } from "./WorktreeDiffView";
import "./lifecycle.css";
import "./worktree-integration.css";

function integrationBlocked(session: SessionView): boolean {
  return Boolean(
    session.stopping ||
    session.resumeStartedAt !== undefined ||
    session.availability?.owner === "mandri" ||
    session.availability?.owner === "external" ||
    (session.state === "live" && session.availability?.owner !== "unowned"),
  );
}

export function WorktreeIntegration({ session }: { session: SessionView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState(false);
  const worktree = session.worktree;
  if (!worktree) return null;
  const closed = worktree.state === "closed";
  return (
    <div className="worktree-integration-bar">
      <div className="worktree-integration-context">
        <GitBranch size={14} aria-hidden="true" />
        <span title={worktree.id}>{worktree.id}</span>
        {closed ? <span>{t("worktree.closed")}</span> : null}
      </div>
      {resolved ? <p role="status">{t("worktree.resolution_ready")}</p> : null}
      {closed ? (
        <button
          className="composer-chip"
          onClick={() =>
            navigate({
              name: "dashboard",
              cwd: worktree.source_path,
              worktree: true,
              surrogate: session.privacyMode === "surrogate",
            })
          }
        >
          {t("worktree.new_session")}
        </button>
      ) : (
        <button className="composer-chip" onClick={() => setOpen(true)}>
          <GitMerge size={14} aria-hidden="true" />
          {t("worktree.open")}
        </button>
      )}
      {open
        ? createPortal(
            <IntegrationDialog
              key={session.id}
              session={session}
              onClose={() => setOpen(false)}
              onResolved={() => {
                setResolved(true);
                setOpen(false);
                requestFocusComposer();
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function IntegrationDialog({
  session,
  onClose,
  onResolved,
}: {
  session: SessionView;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [review, setReview] = useState<IntegrationPreview>();
  const [target, setTarget] = useState("");
  const [strategy, setStrategy] = useState<IntegrationStrategy>("squash");
  const [message, setMessage] = useState(session.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [integrated, setIntegrated] = useState<{ target: string; commit: string }>();
  const [hasIgnoredFiles, setHasIgnoredFiles] = useState(false);
  const [discardIgnored, setDiscardIgnored] = useState(false);
  const operation = useRef(false);
  const initialReviewRequested = useRef(false);
  const blocked = integrationBlocked(session);
  const unavailable = busy || blocked;
  const close = () => {
    if (!operation.current) onClose();
  };
  useOverlayFocus(panel, true, close);
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (operation.current) return;
      const latest = sessionsStore.getState().sessions[session.id] ?? session;
      if (integrationBlocked(latest)) {
        setError(t("worktree.wait"));
        return;
      }
      operation.current = true;
      setBusy(true);
      setError(undefined);
      try {
        await action();
      } catch (caught) {
        setError(t(errorKey(caught)));
      } finally {
        operation.current = false;
        setBusy(false);
      }
    },
    [session, t],
  );
  const refresh = useCallback(
    () =>
      run(async () => {
        setReview(undefined);
        const next = await previewIntegration(
          session.id,
          target || session.worktree?.integrated_target || undefined,
          strategy,
        ).catch((caught) => {
          setTarget("");
          throw caught;
        });
        setReview(next);
        setTarget(next.target ?? "");
        if (
          session.worktree?.integrated_commit &&
          session.worktree.integrated_target === next.target &&
          !next.files?.length &&
          next.target
        ) {
          setIntegrated({ target: next.target, commit: session.worktree.integrated_commit });
        }
      }),
    [run, session.id, session.worktree, strategy, target],
  );
  useEffect(() => {
    if (blocked || initialReviewRequested.current) return;
    initialReviewRequested.current = true;
    void refresh();
  }, [blocked, refresh]);
  const finish = () =>
    run(async () => {
      const row = await finishWorktree(session.id, discardIgnored).catch((caught) => {
        if (caught instanceof DaemonError && caught.code === "worktree_ignored_files") {
          setHasIgnoredFiles(true);
        }
        throw caught;
      });
      sessionsStore.getState().upsertFromRest([row]);
      onClose();
    });
  const merge = () =>
    run(async () => {
      if (!review) return;
      try {
        const row = await integrateWorktree(session.id, review, message.trim());
        sessionsStore.getState().upsertFromRest([row]);
        if (row.worktree?.integrated_commit && row.worktree.integrated_target) {
          setIntegrated({
            target: row.worktree.integrated_target,
            commit: row.worktree.integrated_commit,
          });
        }
      } catch (caught) {
        setReview(undefined);
        const row = await getSession(session.id).catch(() => undefined);
        if (row) sessionsStore.getState().upsertFromRest([row]);
        throw caught;
      }
    });
  const resolve = () =>
    run(async () => {
      if (review) {
        await resolveWorktree(session.id, review);
        onResolved();
      }
    });
  const conflicts = review?.conflicts ?? [];
  return (
    <div className="lifecycle-overlay" role="presentation" onClick={close}>
      <div
        ref={panel}
        className={`lifecycle-panel worktree-integration-panel${fullscreen ? " worktree-integration-panel--fullscreen" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-integration-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="worktree-integration-heading">
          <h2 id="worktree-integration-title">{t("worktree.title")}</h2>
          <div className="worktree-window-actions">
            <button
              type="button"
              className="worktree-icon-button"
              aria-label={t(fullscreen ? "worktree.exit_fullscreen" : "worktree.fullscreen")}
              title={t(fullscreen ? "worktree.exit_fullscreen" : "worktree.fullscreen")}
              aria-pressed={fullscreen}
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? (
                <Minimize2 size={18} aria-hidden="true" />
              ) : (
                <Maximize2 size={18} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="worktree-icon-button"
              aria-label={t("core.actions.close")}
              disabled={busy}
              onClick={close}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="worktree-integration-body">
          {integrated ? (
            <div className="worktree-integration-controls">
              <p role="status">
                {t("worktree.success", {
                  branch: integrated.target,
                  commit: integrated.commit.slice(0, 8),
                })}
              </p>
              <p className="lifecycle-panel-body">{t("worktree.finish_hint")}</p>
              {hasIgnoredFiles ? (
                <label className="lifecycle-checkbox">
                  <input
                    type="checkbox"
                    checked={discardIgnored}
                    disabled={unavailable}
                    onChange={(event) => setDiscardIgnored(event.target.checked)}
                  />
                  {t("worktree.discard_ignored")}
                </label>
              ) : null}
            </div>
          ) : (
            <>
              <div className="worktree-integration-controls">
                <p className="lifecycle-panel-body">{t("worktree.description")}</p>
                {busy && !review ? <p role="status">{t("worktree.loading_review")}</p> : null}
                {review ? (
                  <div className="worktree-integration-fields">
                    <IntegrationSelect
                      label={t("worktree.target")}
                      value={target}
                      placeholder={t("worktree.choose_branch")}
                      disabled={unavailable}
                      icon={<GitBranch size={15} aria-hidden="true" />}
                      options={review.branches.map((branch) => ({
                        value: branch,
                        label: branch,
                        description:
                          branch === review.default_branch ? t("worktree.default") : undefined,
                      }))}
                      onChange={(value) => {
                        setTarget(value);
                        setReview((current) => (current ? { ...current, token: null } : current));
                      }}
                    />
                    <IntegrationSelect<IntegrationStrategy>
                      label={t("worktree.method")}
                      value={strategy}
                      disabled={unavailable}
                      icon={<GitMerge size={15} aria-hidden="true" />}
                      options={[
                        { value: "squash", label: t("worktree.squash") },
                        { value: "merge", label: t("worktree.merge") },
                      ]}
                      onChange={(value) => {
                        setStrategy(value);
                        setReview((current) => (current ? { ...current, token: null } : current));
                      }}
                    />
                  </div>
                ) : null}
                {review && !review.default_branch ? (
                  <p className="lifecycle-panel-body">{t("worktree.no_default")}</p>
                ) : null}
                {review?.token ? (
                  <>
                    <label className="worktree-message">
                      {t("worktree.message")}
                      <input
                        className="lifecycle-input"
                        value={message}
                        disabled={unavailable}
                        onChange={(event) => setMessage(event.target.value)}
                      />
                    </label>
                    <div className="worktree-review-summary">
                      <span>{t("worktree.files", { count: review.files?.length ?? 0 })}</span>
                      <span className="worktree-review-branches">
                        <GitBranch size={14} aria-hidden="true" />
                        {session.worktree?.id} → {review.target}
                      </span>
                    </div>
                    {review.target_dirty ? (
                      <p role="alert" className="lifecycle-error">
                        {t("error.worktree_target_dirty")}
                      </p>
                    ) : null}
                    {conflicts.length ? (
                      <div className="worktree-conflicts">
                        <p>{t("worktree.conflicts_hint")}</p>
                        <ul>
                          {conflicts.map((file) => (
                            <li key={file}>{file}</li>
                          ))}
                        </ul>
                        <p className="lifecycle-panel-body">{t("worktree.resolve_hint")}</p>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              {review?.token ? (
                <WorktreeDiff
                  diff={review.diff ?? ""}
                  paths={review.files ?? []}
                  fullscreen={fullscreen}
                />
              ) : null}
            </>
          )}
        </div>
        <footer className="worktree-integration-footer">
          {blocked ? <p role="status">{t("worktree.wait")}</p> : null}
          {error ? (
            <p role="alert" className="lifecycle-error">
              {error}
            </p>
          ) : null}
          <div className="lifecycle-panel-actions">
            {integrated ? (
              <>
                <button className="lifecycle-button" disabled={busy} onClick={close}>
                  {t("worktree.continue")}
                </button>
                <button
                  className="lifecycle-button lifecycle-button--primary"
                  disabled={unavailable}
                  onClick={() => void finish()}
                >
                  {t("worktree.finish")}
                </button>
              </>
            ) : (
              <>
                <button
                  className="lifecycle-button"
                  disabled={unavailable}
                  onClick={() => void refresh()}
                >
                  {t(busy ? "worktree.working" : review ? "worktree.refresh" : "worktree.prepare")}
                </button>
                {conflicts.length > 0 && review?.token ? (
                  <button
                    className="lifecycle-button lifecycle-button--primary"
                    disabled={unavailable}
                    onClick={() => void resolve()}
                  >
                    {t("worktree.resolve")}
                  </button>
                ) : review ? (
                  <button
                    className="lifecycle-button lifecycle-button--primary"
                    disabled={
                      unavailable ||
                      !review.token ||
                      !review.files?.length ||
                      review.target_dirty ||
                      !message.trim()
                    }
                    onClick={() => void merge()}
                  >
                    {target ? t("worktree.integrate", { branch: target }) : t("worktree.title")}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
