import { preloadCommandCatalogs, resetCommandCatalogs } from "@/features/commands/catalogCache";
import { commandTransport } from "@/features/commands/service";
import { MandriSocket } from "@/daemon/ws/socket";
import { setBaseUrl } from "@/daemon/rest/client";
import { connectionStore } from "@/stores/connection";
import { preferencesStore } from "@/stores/preferences";
import { createDebugLogger } from "@/lib/debug";
import { dispatchFrame } from "./framePipeline";
import { isTauri } from "@/lib/platform";
import { ensureDesktopDaemon } from "@/lib/platform/daemon";
import { appLog } from "@/lib/platform/log";
import { daemonIdentity } from "@/daemon/identity";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { panesStore } from "@/stores/panes";
import { approvalsStore } from "@/stores/approvals";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { invalidateSessionMetadata } from "./sessionSync";

const log = createDebugLogger("connection");

let socket: MandriSocket | null = null;
let connectionAttempt = 0;

connectionStore.subscribe((state, previous) => {
  if (state.status === "online" && previous.status !== "online")
    void preloadCommandCatalogs(commandTransport, true);
});

export function buildWsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const withoutScheme = trimmed.replace(/^https?:\/\//, "");
  const wsBase = trimmed.startsWith("https://")
    ? `wss://${withoutScheme}`
    : `ws://${withoutScheme}`;
  return wsBase.endsWith("/v1/ws") ? wsBase : `${wsBase}/v1/ws`;
}

export function getDaemonSocket(): MandriSocket | null {
  return socket;
}

export function connectDaemon(): void {
  const attempt = ++connectionAttempt;
  const { daemonBaseUrl } = preferencesStore.getState();
  connectionStore.getState().setStartupError(null);
  const endpoint = daemonBaseUrl.trim().replace(/\/+$/, "");
  if (isTauri() && ["http://127.0.0.1:8787", "http://localhost:8787"].includes(endpoint)) {
    connectionStore.getState().setStatus("connecting");
    void ensureDesktopDaemon()
      .then((url) => {
        if (attempt === connectionAttempt) connectUrl(url);
      })
      .catch((error: unknown) => {
        if (attempt !== connectionAttempt) return;
        void appLog("error", `Local daemon startup failed: ${String(error)}`);
        connectionStore.getState().setStartupError(String(error));
        connectionStore.getState().setStatus("offline");
      });
    return;
  }
  connectUrl(daemonBaseUrl);
}

function connectUrl(daemonBaseUrl: string): void {
  if (daemonIdentity.getState().baseUrl !== daemonBaseUrl.trim().replace(/\/+$/, "")) {
    socket?.close();
    invalidateSessionMetadata();
    resetCommandCatalogs();
    for (const id of new Set([
      ...Object.keys(sessionsStore.getState().sessions),
      ...Object.keys(transcriptStore.getState().transcripts),
    ])) {
      keepAlive.forget(id);
      sessionFeed.closeSession(id);
    }
    socket = null;
    panesStore.getState().closeAll();
    sessionsStore.setState(sessionsStore.getInitialState());
    transcriptStore.getState().resetTranscripts();
    approvalsStore.setState(approvalsStore.getInitialState());
  }
  setBaseUrl(daemonBaseUrl);
  const url = buildWsUrl(daemonBaseUrl);
  connectionStore.getState().setEndpoint(url);
  log.info("connectDaemon invoked", {
    baseUrl: daemonBaseUrl,
    wsUrl: url,
    socketExists: socket !== null,
  });
  try {
    if (typeof WebSocket === "undefined") {
      log.warn("WebSocket unavailable in this environment");
      connectionStore.getState().setStatus("offline");
      return;
    }
    if (socket === null) {
      socket = new MandriSocket();
      socket.onFrame(dispatchFrame);
    }
    socket.connect(url);
  } catch (error) {
    log.error("connectDaemon failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    connectionStore.getState().setStatus("offline");
  }
}
