import { useRef, useState } from "react";
import { ChevronDown, Box } from "lucide-react";
import { useTranslation } from "react-i18next";
import { navigate } from "@/app/useHashRoute";
import {
  policyChoice,
  choicePolicy,
  policyFromWire,
  type ProtectionChoice,
} from "@/daemon/protection";
import { DaemonError } from "@/daemon/errors";
import { forkSession, setSessionPrivacy } from "@/daemon/rest/protection";
import { queueSessionModelChange } from "@/features/providers/sessionModelQueue";
import { cancelStartup } from "@/daemon/rest/runtime";
import { getSession, renameWorktree } from "@/daemon/rest/sessions";
import { sessionsStore, type SessionView } from "@/stores/sessions";
import { ChipPopover } from "@/features/transcript/ChipPopover";
import { PrivacyInventoryDialog } from "./PrivacyInventory";
import { ProtectionMenu } from "./ProtectionMenu";
import { DEFAULT_MODE } from "./permissionModes";
import { errorKey } from "./lifecycle";
import { useExecutionStatus } from "./executionStatus";
import "./protection.css";
import "./permissions.css";

export function SessionProtection({ session }: { session: SessionView }) {
  if (
    session.worktree?.state === "closed" ||
    session.state === "discovered" ||
    session.availability?.owner === "external" ||
    session.externalBusy
  ) {
    return null;
  }
  return <ManagedSessionProtection key={session.id} session={session} />;
}

function ManagedSessionProtection({ session }: { session: SessionView }) {
  useExecutionStatus(session.id);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const choice = policyChoice(session);
  return (
    <div className="protection-status">
      <div className="composer-chip-anchor" ref={anchorRef}>
        <button
          type="button"
          className="composer-chip"
          aria-label={t("core.protection.label")}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen(!open)}
        >
          <Box size={14} aria-hidden="true" />
          <span className="composer-chip-label">
            {session.worktree
              ? `${session.worktree.id}${session.privacyMode === "surrogate" ? ` (${t("core.protection.surrogate")})` : ""}`
              : t(`core.protection.${choice}`)}
          </span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {open ? (
          <ChipPopover
            anchorRef={anchorRef}
            align="start"
            className="session-protection-popover"
            maxHeight={600}
            onClose={() => {
              if (!busy) setOpen(false);
            }}
          >
            <PolicyFork
              session={session}
              onClose={() => setOpen(false)}
              onBusyChange={setBusy}
              onPrivacyInfo={() => {
                setOpen(false);
                setPrivacyOpen(true);
              }}
            />
          </ChipPopover>
        ) : null}
      </div>
      {privacyOpen ? (
        <PrivacyInventoryDialog sessionId={session.id} onClose={() => setPrivacyOpen(false)} />
      ) : null}
      {session.resumeStartedAt === undefined && session.executionReason ? (
        <span role="alert" className="protection-summary">
          {t(`error.${session.executionReason}`, { defaultValue: t("error.unknown") })}
        </span>
      ) : null}
    </div>
  );
}

function PolicyFork({
  session,
  onClose,
  onBusyChange,
  onPrivacyInfo,
}: {
  session: SessionView;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onPrivacyInfo: () => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ProtectionChoice>(policyChoice(session));
  const [worktreeId, setWorktreeId] = useState("");
  const mode = session.interactionMode ?? DEFAULT_MODE[session.harness];
  const canChange = session.state === "stopped" && session.resumeStartedAt === undefined;
  const selectedEnvironment = choicePolicy(choice);
  const currentEnvironment = choicePolicy(policyChoice(session));
  const changed =
    selectedEnvironment.execution_backend !== currentEnvironment.execution_backend ||
    !!selectedEnvironment.worktree !== !!currentEnvironment.worktree;
  const nativeModel = session.model?.startsWith("native:") !== false;
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const operation = useRef<{ id: string; cancelled: boolean } | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [contextAttempted, setContextAttempted] = useState(false);
  const selectedPolicy = choicePolicy(choice);
  const policy = {
    ...selectedPolicy,
    ...(selectedPolicy.worktree && worktreeId.trim() ? { worktree_id: worktreeId.trim() } : {}),
  };
  const select = async (next: ProtectionChoice) => {
    const nextPolicy = choicePolicy(next);
    if (nextPolicy.privacy_mode === selectedPolicy.privacy_mode) {
      if (!canChange && next !== choice) {
        setContextAttempted(true);
        return;
      }
      setChoice(next);
      return;
    }
    if (busy || nativeModel) return;
    setContextAttempted(false);
    setBusy(true);
    onBusyChange(true);
    setError(undefined);
    try {
      await queueSessionModelChange(session.id, async () => {
        const row = await setSessionPrivacy(session.id, nextPolicy.privacy_mode);
        const confirmed = policyFromWire(row);
        if (
          row.id !== session.id ||
          !confirmed.policyConfirmed ||
          confirmed.privacyMode !== nextPolicy.privacy_mode
        ) {
          throw new DaemonError({
            code: "session_policy_unconfirmed",
            message: "The daemon did not confirm the privacy mode",
          });
        }
        sessionsStore.getState().upsertFromRest([row]);
      });
      setChoice(next);
    } catch (caught) {
      setError(t(errorKey(caught)));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  const submit = async () => {
    if (busy || !canChange || !changed) return;
    const current = { id: crypto.randomUUID(), cancelled: false };
    operation.current = current;
    setBusy(true);
    onBusyChange(true);
    setError(undefined);
    try {
      const result = await forkSession(session.id, { ...policy, mode, operation_id: current.id });
      if (current.cancelled) return;
      const confirmed = policyFromWire(result);
      if (
        result.id === session.id ||
        !confirmed.policyConfirmed ||
        policyChoice(confirmed) !== choice
      ) {
        throw new DaemonError({
          code: "session_policy_unconfirmed",
          message: "The daemon did not confirm the fork policy",
        });
      }
      const row = await getSession(result.id);
      if (current.cancelled) return;
      const hydrated = policyFromWire(row);
      if (row.id !== result.id || !hydrated.policyConfirmed || policyChoice(hydrated) !== choice) {
        throw new DaemonError({
          code: "session_policy_unconfirmed",
          message: "The fork snapshot did not confirm the selected policy",
        });
      }
      sessionsStore.getState().upsertFromRest([row]);
      navigate({ name: "session", id: result.id });
      onClose();
    } catch (caught) {
      if (!current.cancelled) setError(t(errorKey(caught)));
    } finally {
      if (!current.cancelled) {
        operation.current = undefined;
        setBusy(false);
        onBusyChange(false);
      }
    }
  };
  const cancel = async () => {
    const current = operation.current;
    if (!current) {
      onClose();
      return;
    }
    current.cancelled = true;
    setCancelling(true);
    try {
      await cancelStartup(current.id);
      operation.current = undefined;
      onBusyChange(false);
      onClose();
    } catch (caught) {
      setError(t(errorKey(caught)));
    } finally {
      setCancelling(false);
    }
  };
  return (
    <div className="session-protection-menu">
      {session.worktree ? (
        <WorktreeIdentity
          session={session}
          disabled={busy || !canChange}
          onBusyChange={(value) => {
            setBusy(value);
            onBusyChange(value);
          }}
        />
      ) : null}
      <ProtectionMenu
        value={choice}
        onSelect={(next) => {
          void select(next);
        }}
        disabled={busy}
        contextLocked={!canChange}
        contextNotice={
          !canChange && contextAttempted ? t("core.protection.stop_to_change") : undefined
        }
        privacyDisabled={
          busy || nativeModel || session.resumeStartedAt !== undefined || !!session.stopping
        }
        worktreeId={worktreeId}
        onWorktreeIdChange={changed ? setWorktreeId : undefined}
        onPrivacyInfo={session.privacyMode === "surrogate" ? onPrivacyInfo : undefined}
      />
      <p className="protection-note">
        {t(nativeModel ? "core.protection.gateway_required" : "core.protection.privacy_live")}
      </p>
      {error ? (
        <p role="alert" className="protection-note">
          {error}
        </p>
      ) : null}
      {changed ? (
        <div className="session-protection-confirm">
          <p className="protection-note">{t("core.protection.fork_description")}</p>
          <div className="protection-fork-actions">
            <button
              type="button"
              className="composer-chip"
              disabled={cancelling}
              onClick={() => {
                void cancel();
              }}
            >
              {t(cancelling ? "core.protection.cancelling" : "core.actions.cancel")}
            </button>
            <button
              type="button"
              className="composer-chip"
              disabled={busy || !canChange}
              onClick={() => {
                void submit();
              }}
            >
              {t(busy ? "core.start.submitting" : "core.protection.create_fork")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WorktreeIdentity({
  session,
  disabled,
  onBusyChange,
}: {
  session: SessionView;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(session.worktree?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savedName, setSavedName] = useState<string>();
  const submit = async () => {
    setSaving(true);
    onBusyChange(true);
    setError(undefined);
    setSavedName(undefined);
    try {
      const row = await renameWorktree(session.id, name.trim());
      sessionsStore.getState().upsertFromRest([row]);
      setName(row.worktree?.id ?? name);
      setSavedName(row.worktree?.id);
    } catch (caught) {
      setError(t(errorKey(caught)));
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };
  return (
    <form
      className="worktree-identity"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="worktree-name-field">
        <label>
          {t("core.protection.worktree_rename_name")}
          <input
            value={name}
            maxLength={100}
            spellCheck={false}
            disabled={disabled || saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p>{t("core.protection.worktree_cleanup")}</p>
      </div>
      <button
        type="submit"
        className="composer-chip"
        disabled={disabled || saving || !name.trim() || name.trim() === session.worktree?.id}
      >
        {t(saving ? "core.start.submitting" : "core.actions.rename")}
      </button>
      {savedName ? (
        <p className="protection-note" role="status">
          {t("core.protection.worktree_renamed", { name: savedName })}
        </p>
      ) : null}
      {error ? (
        <p className="protection-note" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
