import { useEffect } from "react";
import { useStore } from "@/app/useStore";
import { getDaemonSocket } from "@/app/connection";
import { connectionStore } from "@/stores/connection";
import { daemonIdentity } from "@/daemon/identity";
import { ingestAgentFrame, refreshAgents } from "@/stores/agents";

export function useAgentsSync(selectedSessionId: string | null): void {
  const status = useStore(connectionStore, (state) => state.status);
  const generation = useStore(daemonIdentity, (state) => state.generation);
  useEffect(() => {
    if (status !== "online") return;
    const socket = getDaemonSocket();
    if (!socket) return;
    const unsubscribe = socket.onFrame(ingestAgentFrame);
    socket.subscribe("agents.all");
    void refreshAgents();
    const timer = setInterval(() => {
      void refreshAgents();
    }, 15_000);
    return () => {
      unsubscribe();
      socket.unsubscribe("agents.all");
      clearInterval(timer);
    };
  }, [status, generation]);
  useEffect(() => {
    if (status !== "online" || selectedSessionId === null) return;
    const socket = getDaemonSocket();
    if (!socket) return;
    let active = true;
    void socket
      .request("agent.list", { session_id: selectedSessionId })
      .then(() => {
        if (active) void refreshAgents();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [status, generation, selectedSessionId]);
}
