import { deliveryUncertain, markDelivery, restoreDelivery } from "./promptDelivery";
import { setFiles } from "./attachments";
import { useCommands } from "@/features/commands/useCommands";
import { useComposerAutosize } from "./useComposerAutosize";
import { commandTransport, type CommandTransport } from "@/features/commands/service";
import { AsyncQuestions, pendingAsyncQuestion } from "./AsyncQuestions";
import { isSessionBusy } from "./turnActivity";
import { daemonIdentity } from "@/daemon/identity";
import { AttachmentButton, AttachmentChips, useAttachmentInput } from "./AttachmentInput";
import {
  draftMessage,
  attachmentMessage,
  uploadFiles,
  removeFiles,
  type DraftAttachment,
} from "./attachments";
import { ChipPopover } from "./ChipPopover";
import { ModelPopover } from "./ModelPopover";
import { HarnessMark, harnessDisplayName, splitModelRef } from "./composerControls";
export { ChipPopover } from "./ChipPopover";
export { ModelMenu } from "./ModelMenu";
export { HarnessMark, harnessDisplayName, splitModelRef } from "./composerControls";
import { useModelProviders } from "@/features/providers/nativeModels";
import { useRuntimeCapabilities } from "@/daemon/runtimeCapabilities";
import { nativeHarness } from "@/daemon/modelSelection";
import { permitsModel, permitsNative } from "@/daemon/protection";
import { ArrowUp, ChevronDown, Square, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { DAEMON_ERROR_I18N_KEYS, DaemonError } from "@/daemon/errors";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import type { PromptOutcome } from "@/daemon/ws/sessionFeed";
import { preferencesStore } from "@/stores/preferences";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { swapSessionModel } from "@/features/providers/swapSessionModel";
import { swapSessionEffort } from "@/features/providers/swapSessionEffort";
import { modelCatalogEntry, supportedModelEffort } from "@/features/providers/modelReasoning";
import {
  HARNESS_MODES,
  permissionLabel,
  permissionTone,
} from "@/features/sessions/permissionModes";
import { SessionProtection } from "@/features/sessions/SessionProtection";
import { PermissionModeIcon } from "@/features/sessions/PermissionModeIcon";
import { PermissionMenu } from "@/features/sessions/PermissionMenu";
import {
  isSessionResumable,
  resumeSessionAction,
  stopSessionAction,
} from "@/features/sessions/lifecycle";
import { createDebugLogger } from "@/lib/debug";
import "./composer.css";

const log = createDebugLogger("composer");

export interface ComposerFeed {
  sendPrompt: (
    sessionId: string,
    content: string,
    attachments?: string[],
  ) => Promise<PromptOutcome>;
  interrupt: (sessionId: string) => Promise<boolean>;
}

export interface ComposerProps {
  sessionId?: string;
  disabled?: boolean;
  onSend?: (text: string) => void;
  harnessLabel?: string;
  modelLabel?: string;
  feed?: ComposerFeed;
  commands?: CommandTransport;
}

function errorKeyOf(error: unknown): string {
  if (error instanceof DaemonError) {
    return DAEMON_ERROR_I18N_KEYS[error.code] ?? "error.unknown";
  }
  return "error.unknown";
}

export function Composer({
  sessionId,
  disabled = false,
  onSend,
  harnessLabel,
  modelLabel,
  feed,
  commands,
}: ComposerProps) {
  const { t } = useTranslation();
  const defaultHarness = useStore(preferencesStore, (state) => state.defaultHarness);
  const defaultModel = useStore(preferencesStore, (state) => state.defaultModel);
  const session = useStore(
    sessionsStore,
    useCallback(
      (state) => (sessionId === undefined ? undefined : state.sessions[sessionId]),
      [sessionId],
    ),
  );
  const [localText, setLocalText] = useState("");
  const draft = useStore(
    sessionsStore,
    useCallback(
      (state) => (sessionId === undefined ? "" : (state.drafts[sessionId] ?? "")),
      [sessionId],
    ),
  );
  const text = sessionId === undefined ? localText : draft;
  const textareaRef = useComposerAutosize();
  const setText = useCallback(
    (value: string): void => {
      if (sessionId === undefined) setLocalText(value);
      else sessionsStore.getState().setDraft(sessionId, value);
    },
    [sessionId],
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const error = sessionId === undefined ? localError : (session?.promptError ?? null);
  const setError = useCallback(
    (value: string | null): void => {
      if (sessionId === undefined) setLocalError(value);
      else sessionsStore.getState().applySessionPatch(sessionId, { promptError: value });
    },
    [sessionId],
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [modePending, setModePending] = useState(false);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const permissionsAnchorRef = useRef<HTMLDivElement>(null);
  const modelAnchorRef = useRef<HTMLDivElement>(null);
  const wired = sessionId !== undefined;
  const live = session?.state === "live";
  const resumable = session !== undefined && isSessionResumable(session).resumable;
  const harnessKind = session?.harness;
  const attachmentsBlocked =
    harnessKind === "agy" || disabled || !!session?.sending || sessionId === undefined;
  const attachmentInput = useAttachmentInput(sessionId ?? "preview", attachmentsBlocked);
  const capabilities = useRuntimeCapabilities(
    harnessKind,
    harnessKind === "agy" && (modelOpen || permissionsOpen),
  );
  const harness =
    harnessLabel ??
    (harnessKind !== undefined
      ? harnessDisplayName(harnessKind, t)
      : (defaultHarness ?? t("core.welcome.default_harness")));
  const modelRef =
    modelLabel ?? session?.model ?? (permitsNative(session ?? {}) ? defaultModel : undefined) ?? "";
  const modelShown = modelRef.length > 0;
  const effort = session?.reasoningEffort ?? null;
  const availableModels = useModelProviders(
    harnessKind,
    session?.projectPath,
    !!nativeHarness(modelRef),
    permitsNative(session ?? {}),
  );
  const modelCatalog = modelCatalogEntry(availableModels, modelRef);
  const visibleEffort = supportedModelEffort(modelCatalog, effort);
  const availability = session?.availability;
  const externallyBlocked = availability?.owner === "external";
  const activityUnknown = !live && availability?.can_resume !== true;
  const canDeliver =
    wired &&
    !modePending &&
    !externallyBlocked &&
    !activityUnknown &&
    !disabled &&
    session?.executionReason !== "session_policy_conflict" &&
    permitsModel(modelRef, session ?? {}) &&
    capabilities?.inputTypes?.includes("text") !== false &&
    !session?.sending &&
    !session?.stopping &&
    (live || resumable === true) &&
    !(harnessKind === "agy" && attachmentInput.files.length > 0);
  const nativeCommands = useCommands({
    sessionId,
    harness: harnessKind,
    cwd: session?.projectPath,
    executionBackend: session?.executionBackend,
    privacyMode: session?.privacyMode,
    text,
    setText,
    enabled: canDeliver,
    busy: isSessionBusy(session),
    transport: commands,
    execute: async (command, args, invocationId) => {
      if (!sessionId) throw new Error(t("commands.unavailable"));
      const generation = daemonIdentity.getState().generation;
      const stopRevision = sessionsStore.getState().sessions[sessionId]?.stopRevision;
      if (sessionsStore.getState().sessions[sessionId]?.state !== "live")
        await resumeSessionAction(sessionId);
      if (
        generation !== daemonIdentity.getState().generation ||
        stopRevision !== sessionsStore.getState().sessions[sessionId]?.stopRevision
      )
        throw new Error(t("commands.unavailable"));
      return (commands ?? commandTransport).invoke(sessionId, invocationId, command.id, args);
    },
  });
  const canSend =
    canDeliver &&
    !nativeCommands.pending &&
    (text.trim().length > 0 || attachmentInput.files.length > 0);
  const showStop = live && text.trim().length === 0 && isSessionBusy(session);
  const question = useStore(
    transcriptStore,
    useCallback(
      (state) => {
        const transcript = sessionId ? state.transcripts[sessionId] : undefined;
        return transcript?.pendingUsers?.length
          ? undefined
          : pendingAsyncQuestion(transcript?.nodes ?? []);
      },
      [sessionId],
    ),
  );
  const sendTitle = wired
    ? live || resumable
      ? capabilities?.steering === "stop_resume" && session?.nativeTurnActive
        ? t("core.composer.steering_stop_resume")
        : undefined
      : t("error.session_not_running")
    : t("core.transcript.send_disabled");

  const deliver = useCallback(
    async (composed: string, id: string, selected: DraftAttachment[]): Promise<void> => {
      if (
        externallyBlocked ||
        activityUnknown ||
        session?.executionReason === "session_policy_conflict"
      )
        return;
      if (sessionsStore.getState().sessions[id]?.sending) return;
      sessionsStore.getState().applySessionPatch(id, {
        sending: true,
        awaitingResponse: true,
        nativeTurnActive: undefined,
      });
      const generation = daemonIdentity.getState().generation;
      const stopRevision = sessionsStore.getState().sessions[id]?.stopRevision;
      const deliveryCurrent = () =>
        generation === daemonIdentity.getState().generation &&
        stopRevision === sessionsStore.getState().sessions[id]?.stopRevision;
      const draftBefore = sessionsStore.getState().drafts[id];
      let pendingKey: string | undefined;
      let submitted = false;
      let filesKey: string | undefined;
      attachmentInput.setError(null);
      setError(null);
      const service = feed ?? sessionFeed;
      let deliveryStage: "attachments" | "resume" | "prompt" = "attachments";
      const requireCurrent = () => {
        if (!deliveryCurrent())
          throw new DaemonError({ code: "operation_cancelled", message: "Delivery interrupted" });
      };
      const send = async (identities: string[]) => {
        requireCurrent();
        markDelivery(id, pendingKey!, "sending");
        submitted = true;
        await (identities.length
          ? service.sendPrompt(id, composed, identities)
          : service.sendPrompt(id, composed));
        if (generation !== daemonIdentity.getState().generation) return;
        markDelivery(id, pendingKey!, "accepted");
        removeFiles(id, selected);
      };
      try {
        if (selected.length) {
          filesKey = `delivery:${crypto.randomUUID()}`;
          setFiles(filesKey, selected);
          requireCurrent();
        }
        const preview = draftMessage(composed, selected);
        pendingKey = transcriptStore.getState().addPendingUser(id, preview.text, preview.images, {
          content: composed,
          state: "preparing",
          filesKey,
        });
        if (sessionsStore.getState().drafts[id] === draftBefore) setText("");
        const uploaded = selected.length ? await uploadFiles(id, selected) : [];
        requireCurrent();
        if (uploaded.length)
          transcriptStore
            .getState()
            .updatePendingUser(id, pendingKey, attachmentMessage(composed, uploaded));
        const identities = uploaded.map((file) => file.id);
        deliveryStage = "resume";
        if (sessionsStore.getState().sessions[id]?.state !== "live") await resumeSessionAction(id);
        requireCurrent();
        deliveryStage = "prompt";
        try {
          await send(identities);
        } catch (promptError) {
          if (
            !(promptError instanceof DaemonError) ||
            !["session_not_running", "invalid_state", "conflict"].includes(promptError.code)
          )
            throw promptError;
          submitted = false;
          markDelivery(id, pendingKey, "preparing");
          requireCurrent();
          deliveryStage = "resume";
          await resumeSessionAction(id);
          requireCurrent();
          deliveryStage = "prompt";
          await send(identities);
        }
      } catch (sendError) {
        if (generation !== daemonIdentity.getState().generation) return;
        const uncertain = submitted && deliveryUncertain(sendError);
        const code = sendError instanceof DaemonError ? sendError.code : null;
        log.warn("delivery failed", {
          sessionId: id,
          stage: deliveryStage,
          code,
          attachmentCount: selected.length,
          message: sendError instanceof Error ? sendError.message : String(sendError),
        });
        if (pendingKey) {
          transcriptStore
            .getState()
            .setDeliveryState(id, pendingKey, uncertain ? "unknown" : "not_sent");
          if (!uncertain) await restoreDelivery(id, pendingKey);
        }
        if (generation !== daemonIdentity.getState().generation) return;
        const attachmentFailure =
          selected.length > 0 &&
          (deliveryStage === "attachments" ||
            code === "attachment_storage_unavailable" ||
            code === "invalid_params");
        if (attachmentFailure)
          attachmentInput.setError(
            code === "attachment_storage_unavailable"
              ? t("error.attachment_storage_unavailable")
              : sendError instanceof Error
                ? sendError.message
                : t("error.unknown"),
          );
        if (deliveryCurrent() || !sessionsStore.getState().sessions[id]?.sending) {
          sessionsStore.getState().applySessionPatch(id, { awaitingResponse: false });
          setError(
            attachmentFailure || (!deliveryCurrent() && !uncertain)
              ? null
              : uncertain
                ? "error.delivery_unknown"
                : errorKeyOf(sendError),
          );
        }
      } finally {
        if (!pendingKey && filesKey && generation === daemonIdentity.getState().generation)
          setFiles(filesKey, []);
        if (deliveryCurrent()) sessionsStore.getState().applySessionPatch(id, { sending: false });
      }
    },
    [
      externallyBlocked,
      activityUnknown,
      feed,
      setText,
      setError,
      session?.executionReason,
      attachmentInput,
      t,
    ],
  );

  const submit = (): void => {
    if (nativeCommands.submit()) return;
    if (!canSend) {
      return;
    }
    const composed = text.trim();
    if (sessionId === undefined) {
      onSend?.(composed);
      return;
    }
    void deliver(composed, sessionId, [...attachmentInput.files]);
  };

  const stop = (): void => {
    if (sessionId === undefined || session?.stopping) return;
    setError(null);
    const generation = daemonIdentity.getState().generation;
    void stopSessionAction(sessionId).catch((stopError: unknown) => {
      if (generation === daemonIdentity.getState().generation) setError(errorKeyOf(stopError));
    });
  };

  const swapModel = useCallback(
    (nextModel: string): void => {
      if (sessionId === undefined) {
        return;
      }
      setModelOpen(false);
      swapSessionModel(sessionId, nextModel)
        .then(() => {
          setError(null);
        })
        .catch((swapError: unknown) => {
          setError(errorKeyOf(swapError));
        });
    },
    [sessionId, setError],
  );

  const swapEffort = useCallback(
    (nextEffort: string | null) => {
      if (sessionId === undefined) {
        return;
      }
      return swapSessionEffort(sessionId, nextEffort).catch((swapError: unknown) => {
        setError(errorKeyOf(swapError));
      });
    },
    [sessionId, setError],
  );

  if (wired && externallyBlocked) {
    return (
      <div className="composer-external" role="status">
        <p>{t("core.composer.external_active", { harness })}</p>
        <div className="composer composer-external-pill">
          <span className="composer-external-model">{session?.externalModel || "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="composer-with-questions" style={{ position: "relative" }}>
      {nativeCommands.panel}
      {question?.questions && (
        <AsyncQuestions
          key={`${sessionId}:${question.key ?? question.text}`}
          questions={question.questions}
          disabled={!canDeliver}
          onAnswer={(answer) => {
            if (!canDeliver || sessionId === undefined) return;
            void deliver([answer, text.trim()].filter(Boolean).join("\n\n"), sessionId, [
              ...attachmentInput.files,
            ]);
          }}
        />
      )}
      <div className="composer">
        <AttachmentChips input={attachmentInput} disabled={!!session?.sending} />
        <textarea
          {...nativeCommands.inputProps}
          ref={textareaRef}
          onPaste={attachmentInput.onPaste}
          className="composer-input"
          value={text}
          aria-label={t("core.welcome.composer_placeholder")}
          placeholder={t("core.welcome.composer_placeholder")}
          rows={2}
          disabled={disabled || externallyBlocked}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (nativeCommands.onKeyDown(event)) return;
            attachmentInput.onKeyDown(event);
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {modeNotice && <div role="status">{t(modeNotice)}</div>}
        {error !== null && (
          <div className="composer-error" role="alert">
            <span className="composer-error-text">{t(error)}</span>
            <button
              type="button"
              className="composer-error-dismiss"
              aria-label={t("core.actions.close")}
              onClick={() => setError(null)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="composer-tools">
          <AttachmentButton
            input={attachmentInput}
            disabled={attachmentsBlocked || externallyBlocked}
          />
          <span className="composer-spacer" aria-hidden="true" />
          {sessionId === undefined ? (
            <span className="composer-chip composer-chip--agent" title={harness}>
              <HarnessMark harness={harnessKind ?? ""} size={14} />
              <span className="composer-chip-label">{harness}</span>
            </span>
          ) : null}
          {harnessKind !== undefined &&
            (capabilities?.permissionModes ?? HARNESS_MODES[harnessKind]).length > 0 && (
              <div className="composer-chip-anchor" ref={permissionsAnchorRef}>
                <button
                  type="button"
                  className="composer-chip composer-permissions"
                  data-setting-tone={permissionTone(
                    harnessKind,
                    session?.resumeMode ?? session?.interactionMode ?? "",
                  )}
                  aria-label={t("core.start.mode")}
                  aria-haspopup="dialog"
                  aria-expanded={permissionsOpen}
                  title={t(
                    live ? "core.composer.permissions_live" : "core.composer.permissions_resume",
                  )}
                  disabled={modePending || disabled || session?.sending || (!live && !resumable)}
                  onClick={() => {
                    setModelOpen(false);
                    setPermissionsOpen((open) => !open);
                  }}
                >
                  <PermissionModeIcon
                    harness={harnessKind}
                    mode={session?.resumeMode ?? session?.interactionMode ?? ""}
                  />
                  <span className="composer-chip-label">
                    {permissionLabel(
                      harnessKind,
                      session?.resumeMode ?? session?.interactionMode ?? "",
                      t,
                    )}
                  </span>
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
                {permissionsOpen && (
                  <ChipPopover
                    anchorRef={permissionsAnchorRef}
                    className="permission-popover"
                    onClose={() => setPermissionsOpen(false)}
                  >
                    <PermissionMenu
                      harness={harnessKind}
                      modes={capabilities?.permissionModes}
                      selected={session?.resumeMode ?? session?.interactionMode ?? ""}
                      onSelect={(mode) => {
                        setPermissionsOpen(false);
                        if (sessionId === undefined) return;
                        if (!live) {
                          sessionsStore
                            .getState()
                            .applySessionPatch(sessionId, { resumeMode: mode });
                          return;
                        }
                        setModePending(true);
                        setError(null);
                        void sessionFeed
                          .setMode(sessionId, mode)
                          .then((result) => {
                            sessionsStore.getState().applySessionPatch(sessionId, {
                              interactionMode: result.mode,
                              resumeMode: undefined,
                            });
                            setModeNotice(
                              result.outcome === "next_turn_applied"
                                ? "core.composer.permissions_next_turn"
                                : result.outcome === "hook_policy_applied"
                                  ? "core.composer.permissions_hooks"
                                  : null,
                            );
                          })
                          .catch((modeError: unknown) => {
                            setError(errorKeyOf(modeError));
                          })
                          .finally(() => setModePending(false));
                      }}
                    />
                  </ChipPopover>
                )}
              </div>
            )}
          {session ? <SessionProtection session={session} /> : null}
          <div className="composer-chip-anchor composer-chip-anchor--model" ref={modelAnchorRef}>
            {sessionId !== undefined ? (
              <span className="composer-model-harness">{harness}</span>
            ) : null}
            <button
              type="button"
              className="composer-chip"
              disabled={!wired || disabled || externallyBlocked}
              aria-haspopup="dialog"
              aria-expanded={modelOpen}
              aria-label={t("core.start.model")}
              title={wired ? undefined : t("core.composer.model_locked")}
              onClick={() => {
                setModelOpen((value) => !value);
              }}
            >
              {modelShown ? (
                <>
                  <span className="composer-chip-label">
                    {nativeHarness(modelRef)
                      ? modelRef.endsWith("/default")
                        ? t("core.providers.native_default")
                        : (modelCatalog?.display_name ?? splitModelRef(modelRef).name)
                      : modelRef}
                  </span>
                  {visibleEffort !== null ? (
                    <span className="composer-chip-suffix">{visibleEffort}</span>
                  ) : null}
                </>
              ) : (
                <span className="composer-chip-suffix">—</span>
              )}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {modelOpen && wired ? (
              <ModelPopover
                anchorRef={modelAnchorRef}
                onClose={() => {
                  setModelOpen(false);
                }}
                allowNative={permitsNative(session ?? {})}
                harness={harnessKind}
                cwd={session?.projectPath}
                onSelect={swapModel}
                onSelectEffort={swapEffort}
                currentEffort={effort}
                currentModel={modelShown ? modelRef : undefined}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="composer-send"
            aria-label={t(showStop ? "core.actions.stop" : "core.actions.send")}
            title={showStop ? t("core.actions.stop") : sendTitle}
            disabled={showStop ? !!session?.stopping : !canSend}
            onClick={showStop ? stop : submit}
          >
            {showStop ? (
              <Square size={12} fill="currentColor" aria-hidden="true" />
            ) : (
              <ArrowUp size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
