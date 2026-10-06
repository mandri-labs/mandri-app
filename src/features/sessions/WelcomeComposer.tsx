import {
  deliveryUncertain,
  markDelivery,
  restoreDelivery,
} from "@/features/transcript/promptDelivery";
import {
  composerStorageKey,
  readComposerStorage,
  writeComposerStorage,
} from "@/lib/composerStorage";
import { useTranscriptViewport } from "@/features/transcript/useTranscriptViewport";
import { useComposerAutosize } from "@/features/transcript/useComposerAutosize";
import { useCommands } from "@/features/commands/useCommands";
import type { CommandTransport } from "@/features/commands/service";
import { startCommandSession } from "./startCommandSession";
import { resolveDefaultHarness } from "./defaultHarness";
import { DaemonError } from "@/daemon/errors";
import { daemonIdentity } from "@/daemon/identity";
import {
  AttachmentButton,
  AttachmentChips,
  useAttachmentInput,
} from "@/features/transcript/AttachmentInput";
import {
  persistFiles,
  draftMessage,
  attachmentMessage,
  uploadFiles,
  removeFiles,
  setFiles,
  setAttachmentError,
} from "@/features/transcript/attachments";
import { useModelProviders } from "@/features/providers/nativeModels";
import { nativeHarness } from "@/daemon/modelSelection";
import {
  choicePolicy,
  permitsModel,
  PROTECTION_CHOICES,
  type ProtectionChoice,
} from "@/daemon/protection";
import { PermissionModeIcon } from "./PermissionModeIcon";
import { PermissionMenu } from "./PermissionMenu";
import { ProtectionMenu } from "./ProtectionMenu";
import { HARNESS_MODES, DEFAULT_MODE, permissionLabel, permissionTone } from "./permissionModes";
import { ArrowUp, ChevronDown, Folder, Box, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FOCUS_COMPOSER_EVENT } from "@/app/keyboard";
import { useStore } from "@/app/useStore";
import { navigate } from "@/app/useHashRoute";
import type { components } from "@/daemon/types/rest.gen";
import type { HarnessKind } from "@/daemon/types/ws";
import { parseRuntimeCapabilities } from "@/daemon/runtimeCapabilities";
import { listRuntimes } from "@/daemon/rest/runtime";
import { Composer } from "@/features/transcript/Composer";
import { ChipPopover } from "@/features/transcript/ChipPopover";
import { ModelPopover } from "@/features/transcript/ModelPopover";
import {
  HarnessMark,
  harnessDisplayName,
  splitModelRef,
} from "@/features/transcript/composerControls";
import "@/features/transcript/composer.css";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { createDebugLogger } from "@/lib/debug";
import { connectionStore } from "@/stores/connection";
import { preferencesStore } from "@/stores/preferences";
import { supportedModelEffort } from "@/features/providers/modelReasoning";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { UserBubble } from "@/features/transcript/renderers/UserBubble";
import { ActivityIndicator } from "@/features/transcript/WorkingIndicator";
import "@/features/transcript/session-view.css";
import { FolderPicker, lastPathSegment } from "./FolderPicker";
import { errorKey, startNewSession } from "./lifecycle";
import "./welcome-composer.css";

const log = createDebugLogger("welcomeComposer");

type RuntimeOut = components["schemas"]["RuntimeOut"];

const HARNESS_KINDS: readonly string[] = ["claude", "codex", "opencode", "agy", "pi"];

function initialMode(harness: string): string {
  return isHarnessKind(harness) ? DEFAULT_MODE[harness] : "";
}

type MenuName = "harness" | "model" | "folder" | "permissions" | "protection";

function isHarnessKind(value: string): value is HarnessKind {
  return HARNESS_KINDS.includes(value);
}

interface WelcomeDraft {
  text: string;
  harness: string;
  mode: string;
  protection: ProtectionChoice;
  worktreeId: string;
  model: string;
  effort: string | null;
  cwd: string | null;
}

export function WelcomeComposer(
  props: {
    initialCwd?: string;
    initialProtection?: ProtectionChoice;
    commands?: CommandTransport;
  } = {},
) {
  const endpoint = useStore(daemonIdentity, (state) => state.baseUrl);
  return <WelcomeComposerContent key={endpoint} {...props} />;
}

function WelcomeComposerContent({
  initialCwd,
  initialProtection,
  commands,
}: {
  initialCwd?: string;
  initialProtection?: ProtectionChoice;
  commands?: CommandTransport;
} = {}) {
  const { t } = useTranslation();
  const defaultHarness = useStore(preferencesStore, (state) => state.defaultHarness);
  const defaultModel = useStore(preferencesStore, (state) => state.defaultModel);
  const defaultEffort = useStore(preferencesStore, (state) => state.defaultEffort);
  const [storageKey] = useState(() => composerStorageKey("welcome"));
  const [saved] = useState(() => {
    const value = readComposerStorage<Partial<WelcomeDraft>>(storageKey, {});
    return value && typeof value === "object" ? value : {};
  });
  const [runtimes, setRuntimes] = useState<RuntimeOut[]>([]);
  const initializedHarness = useRef<{ preference: typeof defaultHarness } | null>(
    saved.harness && isHarnessKind(saved.harness) ? { preference: defaultHarness } : null,
  );
  const [harness, setHarness] = useState(
    typeof saved.harness === "string" && isHarnessKind(saved.harness) ? saved.harness : "",
  );
  const [mode, setMode] = useState(typeof saved.mode === "string" ? saved.mode : "");
  const [protection, setProtection] = useState<ProtectionChoice>(
    initialProtection ??
      (saved.protection && PROTECTION_CHOICES.includes(saved.protection)
        ? saved.protection
        : "standard"),
  );
  const [worktreeId, setWorktreeId] = useState(
    typeof saved.worktreeId === "string" ? saved.worktreeId : "",
  );
  const policy = useMemo(() => {
    const selected = choicePolicy(protection);
    return {
      ...selected,
      ...(selected.worktree && worktreeId.trim() ? { worktree_id: worktreeId.trim() } : {}),
    };
  }, [protection, worktreeId]);
  const allowNative = policy.privacy_mode === "none" && policy.execution_backend === "host";
  const [model, setModel] = useState(
    typeof saved.model === "string" ? saved.model : (defaultModel ?? ""),
  );
  const [effort, setEffort] = useState<string | null>(
    saved.effort === null || typeof saved.effort === "string"
      ? saved.effort
      : (defaultEffort ?? null),
  );
  const [cwd, setCwd] = useState<string | null>(
    initialCwd ?? (typeof saved.cwd === "string" ? saved.cwd : null),
  );
  const [text, setText] = useState(typeof saved.text === "string" ? saved.text : "");
  const [submitting, setSubmitting] = useState(false);
  const startupViewportRef = useTranscriptViewport(submitting);
  const [commandStarted, setCommandStarted] = useState(false);
  const startOperation = useRef<{ id: string; navigated: boolean } | undefined>(undefined);
  const connectionStatus = useStore(connectionStore, (state) => state.status);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const textareaRef = useComposerAutosize();
  const harnessAnchorRef = useRef<HTMLDivElement>(null);
  const modelAnchorRef = useRef<HTMLDivElement>(null);
  const folderAnchorRef = useRef<HTMLDivElement>(null);
  const protectionAnchorRef = useRef<HTMLDivElement>(null);
  const permissionsAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRuntimeError(null);
    if (connectionStatus !== "online") return;
    let cancelled = false;
    // Desktop startup must finish before querying the daemon.
    listRuntimes({
      shouldRetry: () => !cancelled && connectionStore.getState().status === "online",
    })
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setRuntimes(rows);
        // Refresh availability without overwriting a draft's harness or permissions.
        if (
          initializedHarness.current === null ||
          initializedHarness.current.preference !== defaultHarness
        ) {
          const chosen = resolveDefaultHarness(rows, defaultHarness);
          initializedHarness.current = chosen ? { preference: defaultHarness } : null;
          setHarness(chosen);
          setMode(initialMode(chosen));
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setRuntimeError(t(errorKey(caught)));
      });
    return () => {
      cancelled = true;
    };
  }, [connectionStatus, defaultHarness, t]);

  const previousDefaults = useRef({ defaultModel, defaultEffort });
  useEffect(() => {
    if (
      previousDefaults.current.defaultModel === defaultModel &&
      previousDefaults.current.defaultEffort === defaultEffort
    )
      return;
    previousDefaults.current = { defaultModel, defaultEffort };
    setModel(defaultModel ?? "");
    setEffort(defaultEffort ?? null);
  }, [defaultModel, defaultEffort]);

  useEffect(() => {
    writeComposerStorage(storageKey, {
      text,
      harness,
      mode,
      protection,
      worktreeId,
      model,
      effort,
      cwd,
    });
  }, [storageKey, text, harness, mode, protection, worktreeId, model, effort, cwd]);

  const providers = useModelProviders(harness, cwd ?? undefined, false, allowNative);
  const modelEntry = useMemo(() => {
    const separator = model.indexOf("/");
    const providerName = model.slice(0, separator);
    const provider = providers[providerName];
    if (provider === undefined || provider.catalogState !== "loaded") {
      return undefined;
    }
    return (provider.modelCatalog ?? []).find((row) => row.id === model.slice(separator + 1));
  }, [providers, model]);

  const effectiveEffort =
    effort ?? (nativeHarness(model) ? null : (modelEntry?.default_effort ?? null));

  useEffect(() => {
    const onFocusComposer = (): void => {
      textareaRef.current?.focus();
    };
    if (initialCwd) onFocusComposer();
    window.addEventListener(FOCUS_COMPOSER_EVENT, onFocusComposer);
    return () => {
      window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocusComposer);
    };
  }, [initialCwd]);

  const runtimeByHarness = useMemo(() => {
    const map = new Map<string, RuntimeOut>();
    for (const runtime of runtimes) {
      map.set(runtime.harness, runtime);
    }
    return map;
  }, [runtimes]);

  const selectedRuntime = runtimeByHarness.get(harness);
  const harnessReady =
    policy.execution_backend === "docker" ||
    (selectedRuntime?.installed === true && selectedRuntime.degraded !== true);
  const modelAllowed = permitsModel(model, {
    executionBackend: policy.execution_backend,
    privacyMode: policy.privacy_mode,
  });
  const modelRequired =
    policy.privacy_mode === "surrogate" || policy.execution_backend === "docker";
  const modelParts = splitModelRef(model);

  const toggleMenu = useCallback((name: MenuName): void => {
    setOpenMenu((current) => (current === name ? null : name));
  }, []);

  const closeMenu = useCallback((): void => {
    setOpenMenu(null);
  }, []);

  const chooseHarness = (next: string): void => {
    setHarness(next);
    if (nativeHarness(model) && nativeHarness(model) !== next) {
      setModel("");
      setEffort(null);
    }
    setMode((current) => (next === harness ? current : initialMode(next)));
    closeMenu();
  };

  const attachmentInput = useAttachmentInput("welcome", harness === "agy" || submitting);
  const canSubmit =
    (text.trim().length > 0 || attachmentInput.files.length > 0) &&
    !(harness === "agy" && attachmentInput.files.length > 0) &&
    cwd !== null &&
    harnessReady &&
    !submitting &&
    modelAllowed &&
    (!modelRequired || model.trim().length > 0);
  const sendTitle = submitting
    ? t("core.start.submitting")
    : !modelAllowed || (modelRequired && !model.trim())
      ? t("core.protection.gateway_required")
      : cwd === null
        ? t("core.start.folder_required")
        : !harnessReady
          ? t("core.start.harness_choose")
          : text.trim().length === 0 && attachmentInput.files.length === 0
            ? t("core.welcome.prompt_required")
            : undefined;

  const nativeCommands = useCommands({
    harness: isHarnessKind(harness) ? harness : undefined,
    cwd: cwd ?? undefined,
    executionBackend: policy.execution_backend,
    privacyMode: policy.privacy_mode,
    text,
    setText,
    enabled: connectionStatus === "online",
    busy: submitting,
    transport: commands,
    execute: async (command, args, invocationId) => {
      if (cwd === null) throw new Error(t("core.start.folder_required"));
      if (!harnessReady) throw new Error(t("core.start.harness_choose"));
      if (!modelAllowed || (modelRequired && !model.trim())) {
        throw new Error(t("core.protection.gateway_required"));
      }
      const operation = { id: crypto.randomUUID(), navigated: false };
      startOperation.current = operation;
      setSubmitting(true);
      setCommandStarted(false);
      setError(null);
      const selected = [...attachmentInput.files];
      try {
        const result = await startCommandSession({
          input: {
            harness,
            model: model.trim(),
            cwd,
            mode: mode || null,
            effort: effectiveEffort,
            ...policy,
            operation_id: operation.id,
          },
          command,
          args,
          invocationId,
          acceptResult: () => startOperation.current === operation,
          onCreated: (sessionId) => {
            setCommandStarted(true);
            writeComposerStorage(storageKey, {
              text: "",
              harness,
              mode,
              protection,
              worktreeId,
              model,
              effort,
              cwd,
            });
            setFiles(sessionId, selected);
            removeFiles("welcome", selected);
          },
          transport: commands,
        });
        operation.navigated = true;
        return result;
      } finally {
        if (startOperation.current === operation) {
          startOperation.current = undefined;
          if (!operation.navigated) setSubmitting(false);
          setCommandStarted(false);
        }
      }
    },
  });

  const submit = (): void => {
    if (nativeCommands.submit()) return;
    if (!canSubmit || cwd === null) {
      return;
    }
    setSubmitting(true);
    setError(null);
    const operation = { id: crypto.randomUUID(), navigated: false };
    startOperation.current = operation;
    const composed = text.trim();
    const selected = [...attachmentInput.files];
    const generation = daemonIdentity.getState().generation;
    startNewSession(
      {
        harness,
        model: model.trim(),
        cwd,
        mode: mode.length > 0 ? mode : null,
        effort: effectiveEffort,
        ...policy,
        ...(operation ? { operation_id: operation.id } : {}),
      },
      () => startOperation.current === operation,
    )
      .then(async (created) => {
        if (
          startOperation.current !== operation ||
          generation !== daemonIdentity.getState().generation
        )
          return;
        if (isHarnessKind(created.harness)) {
          sessionFeed.ensureSession(created.id, created.harness, { newSession: true });
          sessionFeed.subscribeSession(created.id);
        }
        const filesKey = selected.length ? `delivery:${crypto.randomUUID()}` : undefined;
        if (filesKey && !(await persistFiles(filesKey, selected)))
          throw new DaemonError({
            code: "composer_storage_unavailable",
            message: "Unable to retain message attachments",
          });
        if (generation !== daemonIdentity.getState().generation) return;
        const preview = draftMessage(composed, selected);
        let pendingKey: string;
        try {
          pendingKey = transcriptStore
            .getState()
            .addPendingUser(created.id, preview.text, preview.images, {
              content: composed,
              state: "preparing",
              filesKey,
            });
        } catch (error) {
          if (filesKey) setFiles(filesKey, []);
          throw error;
        }
        writeComposerStorage(storageKey, {
          text: "",
          harness,
          mode,
          protection,
          worktreeId,
          model,
          effort,
          cwd,
        });
        setFiles(created.id, selected);
        removeFiles("welcome", selected);
        let submitted = false;
        const stopRevision = sessionsStore.getState().sessions[created.id]?.stopRevision;
        sessionsStore.getState().applySessionPatch(created.id, {
          sending: true,
          awaitingResponse: true,
          promptError: null,
        });
        navigate({ name: "session", id: created.id });
        operation.navigated = true;
        if (composed.length > 0 || selected.length > 0) {
          log.info("delivering first prompt to new session", {
            sessionId: created.id,
            contentLength: composed.length,
          });
          await uploadFiles(created.id, selected)
            .then((uploaded) => {
              if (generation !== daemonIdentity.getState().generation) return;
              if (stopRevision !== sessionsStore.getState().sessions[created.id]?.stopRevision) {
                throw new DaemonError({
                  code: "operation_cancelled",
                  message: "Delivery interrupted",
                });
              }
              if (uploaded.length) {
                transcriptStore
                  .getState()
                  .updatePendingUser(created.id, pendingKey, attachmentMessage(composed, uploaded));
              }
              markDelivery(created.id, pendingKey, "sending");
              submitted = true;
              return uploaded.length
                ? sessionFeed.sendPrompt(
                    created.id,
                    composed,
                    uploaded.map((file) => file.id),
                  )
                : sessionFeed.sendPrompt(created.id, composed);
            })
            .then(() => {
              if (generation !== daemonIdentity.getState().generation) return;
              markDelivery(created.id, pendingKey, "accepted");
              removeFiles(created.id, selected);
              sessionsStore.getState().applySessionPatch(created.id, { promptError: null });
            })
            .catch(async (promptError: unknown) => {
              if (generation !== daemonIdentity.getState().generation) return;
              if (selected.length)
                setAttachmentError(
                  created.id,
                  promptError instanceof Error ? promptError.message : t("error.unknown"),
                );
              if (submitted && deliveryUncertain(promptError)) {
                transcriptStore.getState().setDeliveryState(created.id, pendingKey, "unknown");
                sessionsStore.getState().applySessionPatch(created.id, {
                  awaitingResponse: false,
                  promptError: "error.delivery_unknown",
                });
                return;
              }
              transcriptStore.getState().setDeliveryState(created.id, pendingKey, "not_sent");
              await restoreDelivery(created.id, pendingKey);
              if (generation !== daemonIdentity.getState().generation) return;
              sessionsStore.getState().applySessionPatch(created.id, {
                awaitingResponse: false,
                promptError: errorKey(promptError),
              });
              log.error("first prompt delivery failed", {
                sessionId: created.id,
                message: promptError instanceof Error ? promptError.message : String(promptError),
              });
            })
            .finally(() => {
              if (
                generation === daemonIdentity.getState().generation &&
                stopRevision === sessionsStore.getState().sessions[created.id]?.stopRevision
              )
                sessionsStore.getState().applySessionPatch(created.id, { sending: false });
            });
        }
      })
      .catch((caught: unknown) => {
        if (startOperation.current === operation) setError(t(errorKey(caught)));
      })
      .finally(() => {
        if (startOperation.current === operation) {
          if (!operation.navigated) setSubmitting(false);
          startOperation.current = undefined;
        }
      });
  };

  const visibleError = error ?? runtimeError;

  if (submitting) {
    return (
      <div className="session-view">
        <div className="session-view-column">
          <div className="transcript">
            <div className="transcript-viewport" ref={startupViewportRef}>
              <div className="transcript-inner transcript-inner--startup">
                <div className="transcript-item transcript-item--static">
                  <UserBubble {...draftMessage(text.trim(), attachmentInput.files)} />
                </div>
                <div className="transcript-item transcript-item--static">
                  <ActivityIndicator
                    label={t(
                      commandStarted
                        ? "commands.running"
                        : policy.execution_backend === "docker"
                          ? "core.protection.preparing"
                          : "core.transcript.thinking",
                    )}
                  />
                </div>
              </div>
            </div>
            <div className="transcript-navigation" />
            {error ? (
              <p className="composer-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="session-view-composer">
            <Composer disabled harnessLabel={harnessDisplayName(harness, t)} modelLabel={model} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome-composer">
      <h1 className="welcome-greeting">{t("core.welcome.title")}</h1>
      <div className="composer">
        {nativeCommands.panel}
        <AttachmentChips input={attachmentInput} disabled={submitting} />
        <textarea
          onPaste={attachmentInput.onPaste}
          ref={textareaRef}
          className="composer-input"
          value={text}
          {...nativeCommands.inputProps}
          aria-label={t("core.welcome.composer_placeholder")}
          placeholder={t("core.welcome.composer_placeholder")}
          rows={2}
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
        {visibleError !== null && (
          <div className="composer-error" role="alert">
            <span className="composer-error-text">{visibleError}</span>
            <button
              type="button"
              className="composer-error-dismiss"
              aria-label={t("core.actions.close")}
              onClick={() => {
                setError(null);
                setRuntimeError(null);
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="composer-tools">
          <AttachmentButton input={attachmentInput} disabled={harness === "agy" || submitting} />
          <div className="composer-chip-anchor" ref={harnessAnchorRef}>
            <button
              type="button"
              className="composer-chip"
              aria-haspopup="dialog"
              aria-expanded={openMenu === "harness"}
              aria-label={t("core.start.harness")}
              onClick={() => {
                toggleMenu("harness");
              }}
            >
              <HarnessMark harness={harness} size={14} />
              <span className="composer-chip-label">
                {harness.length > 0
                  ? harnessDisplayName(harness, t)
                  : t("core.start.harness_choose")}
              </span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {openMenu === "harness" ? (
              <ChipPopover
                anchorRef={harnessAnchorRef}
                onClose={closeMenu}
                className="chip-popover--harness"
              >
                <div className="welcome-menu">
                  {runtimes.map((runtime) => {
                    const notInstalled =
                      policy.execution_backend === "docker" ? false : !runtime.installed;
                    const unavailable =
                      notInstalled || (policy.execution_backend === "host" && runtime.degraded);
                    const reason = notInstalled
                      ? t("core.start.harness_not_installed")
                      : policy.execution_backend === "host" && runtime.degraded
                        ? t("core.start.harness_degraded")
                        : null;
                    return (
                      <div key={runtime.harness} className="welcome-menu-row-anchor">
                        <button
                          type="button"
                          className={`welcome-menu-row${
                            runtime.harness === harness ? " welcome-menu-row--active" : ""
                          }`}
                          disabled={unavailable}
                          title={reason ?? undefined}
                          onClick={() => {
                            chooseHarness(runtime.harness);
                          }}
                        >
                          <HarnessMark harness={runtime.harness} size={14} />
                          <span className="welcome-menu-row-label">
                            {harnessDisplayName(runtime.harness, t)}
                          </span>
                          {reason !== null ? (
                            <span className="welcome-menu-row-reason">{reason}</span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </ChipPopover>
            ) : null}
          </div>
          <div className="composer-chip-anchor composer-chip-anchor--model" ref={modelAnchorRef}>
            <button
              type="button"
              className="composer-chip"
              aria-haspopup="dialog"
              aria-expanded={openMenu === "model"}
              aria-label={t("core.start.model")}
              onClick={() => {
                toggleMenu("model");
              }}
            >
              {model.length > 0 ? (
                <>
                  <span className="composer-chip-label">{modelParts.name}</span>
                  <span className="composer-chip-suffix">{modelParts.prefix}</span>
                  {(modelEntry
                    ? supportedModelEffort(modelEntry, effectiveEffort)
                    : effectiveEffort) !== null ? (
                    <span className="composer-chip-suffix">{` (${effectiveEffort})`}</span>
                  ) : null}
                </>
              ) : (
                <span className="composer-chip-suffix">{t("core.welcome.model_placeholder")}</span>
              )}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {openMenu === "model" ? (
              <ModelPopover
                anchorRef={modelAnchorRef}
                onClose={closeMenu}
                allowNative={allowNative}
                harness={harness}
                cwd={cwd ?? undefined}
                onSelect={(modelRef) => {
                  setModel(modelRef);
                  setEffort(null);
                  closeMenu();
                }}
                onSelectEffort={(nextEffort) => {
                  setEffort(nextEffort);
                }}
                currentEffort={effectiveEffort}
                currentModel={model.length > 0 ? model : undefined}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="composer-send"
            aria-label={t("core.actions.send")}
            title={sendTitle}
            disabled={!canSubmit}
            onClick={submit}
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="welcome-config-bar">
        <div className="composer-chip-anchor" ref={folderAnchorRef}>
          <button
            type="button"
            className="composer-chip welcome-config-trigger"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "folder"}
            aria-label={t("core.start.folder")}
            title={cwd ?? undefined}
            onClick={() => {
              toggleMenu("folder");
            }}
          >
            <Folder size={14} aria-hidden="true" />
            <span className="welcome-config-label">
              {cwd === null ? t("core.welcome.folder_placeholder") : lastPathSegment(cwd)}
            </span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {openMenu === "folder" ? (
            <ChipPopover
              anchorRef={folderAnchorRef}
              onClose={closeMenu}
              className="chip-popover--folder"
              placement="bottom"
            >
              <FolderPicker
                value={cwd}
                onSelect={(path) => {
                  setCwd(path);
                  closeMenu();
                }}
              />
            </ChipPopover>
          ) : null}
        </div>
        {isHarnessKind(harness) &&
        (
          parseRuntimeCapabilities(selectedRuntime?.capabilities)?.permissionModes ??
          HARNESS_MODES[harness]
        ).length > 0 ? (
          <div className="composer-chip-anchor" ref={permissionsAnchorRef}>
            <button
              type="button"
              className="composer-chip welcome-config-trigger"
              aria-haspopup="dialog"
              data-setting-tone={permissionTone(harness, mode)}
              aria-expanded={openMenu === "permissions"}
              aria-label={t("core.start.mode")}
              onClick={() => toggleMenu("permissions")}
            >
              <PermissionModeIcon harness={harness} mode={mode} />
              <span className="welcome-config-label">{permissionLabel(harness, mode, t)}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {openMenu === "permissions" ? (
              <ChipPopover
                anchorRef={permissionsAnchorRef}
                onClose={closeMenu}
                className="welcome-permissions-popover"
                placement="bottom"
                align="start"
              >
                <PermissionMenu
                  harness={harness}
                  selected={mode}
                  indicatorSide="left"
                  modes={parseRuntimeCapabilities(selectedRuntime?.capabilities)?.permissionModes}
                  onSelect={(next) => {
                    setMode(next);
                    closeMenu();
                  }}
                />
              </ChipPopover>
            ) : null}
          </div>
        ) : null}
        <div className="composer-chip-anchor" ref={protectionAnchorRef}>
          <button
            type="button"
            className="composer-chip welcome-config-trigger welcome-config-trigger--execution"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "protection"}
            aria-label={t("core.protection.label")}
            onClick={() => toggleMenu("protection")}
          >
            <Box size={14} aria-hidden="true" />
            <span className="welcome-config-label">{t(`core.protection.${protection}`)}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {openMenu === "protection" ? (
            <ChipPopover
              anchorRef={protectionAnchorRef}
              onClose={closeMenu}
              className="welcome-protection-popover"
              maxHeight={520}
              placement="top"
              align="start"
            >
              <ProtectionMenu
                value={protection}
                worktreeId={worktreeId}
                onWorktreeIdChange={setWorktreeId}
                disabled={submitting}
                onSelect={(next) => {
                  setProtection(next);
                  setError(null);
                }}
              />
            </ChipPopover>
          ) : null}
        </div>
      </div>
      {!modelAllowed ? (
        <p className="welcome-model-notice" role="status">
          {t("core.protection.gateway_required")}
        </p>
      ) : null}
    </div>
  );
}
