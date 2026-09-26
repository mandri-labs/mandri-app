import { canDismissCommand, commandDismissalKey, commandDismissals, dismissCommand } from "./dismissals";
import { sessionsStore } from "@/stores/sessions";
import { commandsForPlacement, type CommandPlacement } from "./placement";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { daemonIdentity } from "@/daemon/identity";
import { commandsStore, EMPTY_COMMANDS, reconcileCommands, rememberCommand } from "./store";
import { commandTransport, type CommandTransport } from "./service";
import { CommandCard } from "./CommandCard";

export function CommandHistory({ sessionId, transport = commandTransport, placement = "all", sync = true }: { sessionId: string; transport?: CommandTransport; placement?: CommandPlacement; sync?: boolean }) {
  const { t } = useTranslation();
  const session = useStore(sessionsStore, useCallback((state) => state.sessions[sessionId], [sessionId]));
  const hidden = useStore(commandDismissals, (state) => state.hidden);
  const records = useStore(commandsStore, useCallback((state) => state.sessions[sessionId] ?? EMPTY_COMMANDS, [sessionId]));
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const [disconnected, setDisconnected] = useState(false);
  const [cancelError, setCancelError] = useState(false);
  useEffect(() => {
    if (!sync) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const rows = await transport.list(sessionId);
        if (!stopped) { reconcileCommands(sessionId, rows); setDisconnected(false); }
      } catch { if (!stopped) setDisconnected(true); }
      if (!stopped) timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [sessionId, generation, transport, sync]);
  const visible = commandsForPlacement(records, placement, session?.harness)
    .filter((record) => placement !== "composer" || !hidden[commandDismissalKey(record)]);
  if (!visible.length) return null;
  return <section className="native-command-history" aria-label={t("commands.history")}>
    {disconnected && <p role="status">{t("commands.disconnected")}</p>}
    {cancelError && <p role="alert">{t("commands.unknown_help")}</p>}
    {visible.map((record) => <CommandCard key={record.invocation_id} invocation={record} onClose={placement === "composer" && canDismissCommand(record, session?.state) ? () => dismissCommand(record, sessionsStore.getState().sessions[sessionId]?.state) : undefined} onCancel={() => {
      setCancelError(false);
      void transport.cancel(sessionId, record.invocation_id).then((next) => {
        if (generation === daemonIdentity.getState().generation) rememberCommand(next);
      }).catch(() => setCancelError(true));
    }} />)}
  </section>;
}
