import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import { connectionStore } from "./connection";
import { listMcpServers, type McpServer, type McpSnapshot } from "@/daemon/rest/mcp";
import type { ServerMessage } from "@/daemon/types/ws";

interface McpState {
  servers: McpServer[];
  revision: number;
  loaded: boolean;
  error: string | null;
  hydrate: (snapshot: McpSnapshot) => void;
}

export const mcpStore = createStore<McpState>()((set) => ({
  servers: [],
  revision: -1,
  loaded: false,
  error: null,
  hydrate: (snapshot) =>
    set((state) =>
      snapshot.revision < state.revision
        ? state
        : {
            servers: snapshot.servers,
            revision: snapshot.revision,
            loaded: true,
            error: null,
          },
    ),
}));

let wantedRevision = -1;
let connectionEpoch = 0;
let pending: { generation: number; epoch: number; promise: Promise<void> } | undefined;

export function refreshMcp(): Promise<void> {
  const generation = daemonIdentity.getState().generation;
  const epoch = connectionEpoch;
  if (pending?.generation === generation && pending.epoch === epoch) return pending.promise;
  const operation = (async () => {
    try {
      do {
        const snapshot = await listMcpServers();
        if (!Array.isArray(snapshot.servers) || !Number.isSafeInteger(snapshot.revision)) {
          throw new Error("MCP unavailable");
        }
        if (daemonIdentity.getState().generation !== generation || epoch !== connectionEpoch)
          return;
        mcpStore.getState().hydrate(snapshot);
      } while (mcpStore.getState().revision < wantedRevision);
    } catch (error) {
      if (daemonIdentity.getState().generation === generation && epoch === connectionEpoch) {
        mcpStore.setState({ error: error instanceof Error ? error.message : "MCP unavailable" });
      }
    }
  })();
  const promise = operation.finally(() => {
    if (pending?.promise === promise) pending = undefined;
  });
  pending = { generation, epoch, promise };
  return promise;
}

export function ingestMcpFrame(frame: ServerMessage): void {
  if (!("topic" in frame) || frame.topic !== "mcp.events") return;
  if ("raw" in frame && frame.raw && typeof frame.raw === "object") {
    const revision = (frame.raw as Record<string, unknown>)["revision"];
    if (typeof revision === "number") wantedRevision = Math.max(wantedRevision, revision);
  }
  void refreshMcp();
}

function resetMcp(): void {
  connectionEpoch += 1;
  wantedRevision = -1;
  pending = undefined;
  mcpStore.setState({ servers: [], revision: -1, loaded: false, error: null });
}

export function watchMcp(): () => void {
  const connected = () => {
    resetMcp();
    void refreshMcp();
  };
  const unsubscribe = connectionStore.subscribe((state, previous) => {
    if (state.status === "online" && previous.status !== "online") connected();
    if (state.status !== "online" && previous.status === "online") resetMcp();
  });
  if (connectionStore.getState().status === "online") connected();
  return unsubscribe;
}

daemonIdentity.subscribe(resetMcp);

export function mcpServerNeedsAttention(server: Pick<McpServer, "enabled" | "state">): boolean {
  return server.enabled && ["error", "auth_required"].includes(server.state);
}

export function mcpNeedsAttention(state: Pick<McpState, "servers" | "loaded" | "error">): boolean {
  return state.error !== null || (state.loaded && state.servers.some(mcpServerNeedsAttention));
}
