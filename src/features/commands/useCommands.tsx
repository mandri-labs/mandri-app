import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { daemonIdentity } from "@/daemon/identity";
import type { CommandInvocation, NativeCommand } from "@/daemon/types/commands";
import { DaemonError } from "@/daemon/errors";
import { commandInput, searchCommands } from "./search";
import { commandTransport, type CommandTransport } from "./service";
import { commandsStore, EMPTY_COMMANDS, rememberCommand } from "./store";
import { connectionStore } from "@/stores/connection";
import type { HarnessKind } from "@/daemon/types/ws";
import { commandCatalogKey, commandCatalogStore, EMPTY_CATALOG, ensureCommandCatalog } from "./catalogCache";
import { CommandPalette } from "./CommandPalette";

export function useCommands({ sessionId, harness, cwd, profileId, executionBackend, privacyMode, execute, text, setText, enabled, busy, transport = commandTransport }: {
  harness?: HarnessKind; cwd?: string; profileId?: string | null; executionBackend?: "host" | "docker"; privacyMode?: "none" | "surrogate";
  execute?: (command: NativeCommand, args: string, invocationId: string) => Promise<CommandInvocation>;
  sessionId?: string; text: string; setText: (text: string) => void; enabled: boolean; busy: boolean; transport?: CommandTransport;
}) {
  const { t } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef(text);
  draftRef.current = text;

  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [explicit, setExplicit] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const records = useStore(commandsStore, useCallback((state) => sessionId ? state.sessions[sessionId] ?? EMPTY_COMMANDS : EMPTY_COMMANDS, [sessionId]));
  const pending = records.some((row) => row.state === "running");
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const input = commandInput(text);
  const online = useStore(connectionStore, (state) => state.status === "online");
  const scope = harness ? { harness, cwd, profile_id: profileId, execution_backend: executionBackend, privacy_mode: privacyMode } : undefined;
  const cacheKey = scope ? commandCatalogKey(transport, scope) : "";
  const interactionKey = `${cacheKey}:${sessionId ?? "welcome"}`;
  const contextRef = useRef(interactionKey);
  contextRef.current = interactionKey;
  const [previousScope, setPreviousScope] = useState(interactionKey);
  if (previousScope !== interactionKey) {
    setPreviousScope(interactionKey);
    setExplicit(null); setError(null); setDismissed(null); setActive(0);
  }
  const open = input !== null && text !== dismissed;
  const cached = useStore(commandCatalogStore, useCallback((state) => state.entries[cacheKey] ?? EMPTY_CATALOG, [cacheKey]));
  const catalog = cached.commands;
  const loading = cached.state === "loading";
  const failed = cached.state === "unavailable";
  const reason = cached.reason;
  useEffect(() => {
    if (!harness || (transport === commandTransport && !online)) return;
    void ensureCommandCatalog(transport, { harness, cwd, profile_id: profileId, execution_backend: executionBackend, privacy_mode: privacyMode });
  }, [harness, cwd, profileId, executionBackend, privacyMode, generation, transport, online]);
  const matches = input ? searchCommands(catalog, input.query) : [];
  const chosen = matches.find((command) => command.id === explicit && command.name.replace(/^\//, "") === input?.query);
  const disabled = !enabled || busy || pending || submitting;
  const run = async (command: NativeCommand, args: string) => {
    if (disabled || (!sessionId && !execute) || command.available === false) return;
    const draft = text;
    const invocationId = crypto.randomUUID();
    setSubmitting(true); setError(null);
    try {
      const record = execute ? await execute(command, args, invocationId) : await transport.invoke(sessionId!, invocationId, command.id, args);
      if (generation !== daemonIdentity.getState().generation) return;
      rememberCommand(record);
      if (interactionKey !== contextRef.current) return;
      if (draft === draftRef.current) setText("");
    } catch (failure) {
      if (generation !== daemonIdentity.getState().generation) return;
      if (interactionKey !== contextRef.current) return;
      if (sessionId && failure instanceof DaemonError && failure.code === "delivery_unknown") {
        rememberCommand({ invocation_id: invocationId, session_id: sessionId, command, state: "unknown", cancellable: false });
        setError(t("commands.unknown_help"));
      } else setError(failure instanceof Error ? failure.message : t("commands.unavailable"));
    } finally { setSubmitting(false); }
  };
  const select = (command: NativeCommand) => {
    if (command.available === false) { setError(command.unavailable_reason || t("commands.blocked")); return; }
    if (disabled) { setError(t("commands.busy")); return; }
    if (command.argument_hint && !input?.arguments && chosen?.id !== command.id) {
      setExplicit(command.id);
      setText(`/${command.name.replace(/^\//, "")} `);
      inputRef.current?.focus();
    }
    else void run(command, input?.arguments ?? "");
  };
  const submit = (): boolean => {
    if (!input) return false;
    if (dismissed === text) { setDismissed(null); return true; }
    if (!loading && !failed && (chosen || matches.length === 1)) select(chosen ?? matches[0]!);
    return true;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    inputRef.current = event.currentTarget;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return true;
    if (!input) return false;
    if (event.key === "Escape") { setDismissed(text); event.preventDefault(); return true; }
    if (open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setActive((value) => matches.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0);
      return true;
    }
    if (open && event.key === "Tab" && matches.length) {
      event.preventDefault(); const command = matches[Math.min(active, matches.length - 1)]!;
      setExplicit(command.id); setText(`/${command.name.replace(/^\//, "")} ${input.arguments}`); return true;
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); return true; }
    return false;
  };
  return {
    pending: pending || submitting,
    submit, onKeyDown,
    inputProps: { onFocus: (event: FocusEvent<HTMLTextAreaElement>) => { inputRef.current = event.currentTarget; }, role: open ? "combobox" : undefined, "aria-haspopup": open ? "listbox" as const : undefined, "aria-controls": open ? id : undefined, "aria-expanded": open ? true : undefined, "aria-autocomplete": open ? "list" as const : undefined,
      "aria-activedescendant": open && matches.length ? `${id}-${Math.min(active, matches.length - 1)}` : undefined },
    panel: <>
      {open && <CommandPalette id={id} commands={matches} active={Math.min(active, Math.max(0, matches.length - 1))} loading={loading} error={failed} reason={reason} emptyCatalog={!catalog.length} onSelect={select} onRefresh={() => { if (scope) void ensureCommandCatalog(transport, scope, true); }} />}
      {error && <p className="native-command-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>{t("commands.close")}</button></p>}
    </>,
  };
}
