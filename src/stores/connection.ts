import { createStore } from "zustand/vanilla";

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline";

export type GapReason = "slow_consumer" | "retention_exceeded" | "history_lost";

export const DEFAULT_WS_ENDPOINT = "ws://127.0.0.1:8787/v1/ws";

export interface ConnectionState {
  startupError: string | null;
  setStartupError: (error: string | null) => void;
  status: ConnectionStatus;
  hasConnected: boolean;
  disconnectedAt: number | null;
  lastSeqByTopic: Record<string, number>;
  gaps: Record<string, GapReason>;
  reconnectAttempt: number;
  endpoint: string;
  setStatus: (status: ConnectionStatus) => void;
  setLastSeq: (topic: string, seq: number) => void;
  recordGap: (topic: string, reason: GapReason) => void;
  clearSeqs: () => void;
  clearGap: (topic: string) => void;
  setReconnectAttempt: (attempt: number) => void;
  setEndpoint: (url: string) => void;
}

export function isLoopback(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    try {
      parsed = new URL(`http://${url}`);
    } catch {
      return false;
    }
  }
  const hostname = parsed.hostname.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export const connectionStore = createStore<ConnectionState>()((set) => ({
  startupError: null,
  setStartupError: (startupError) => set({ startupError }),
  status: "connecting",
  hasConnected: false,
  disconnectedAt: Date.now(),
  lastSeqByTopic: {},
  gaps: {},
  reconnectAttempt: 0,
  endpoint: DEFAULT_WS_ENDPOINT,
  setStatus: (status) => {
    set((state) => ({
      status,
      hasConnected: state.hasConnected || status === "online",
      // Keep the same deadline across reconnect attempts and manual retries.
      disconnectedAt: status === "online" ? null : (state.disconnectedAt ?? Date.now()),
      startupError: status === "online" ? null : state.startupError,
    }));
  },
  setLastSeq: (topic, seq) => {
    set((state) => ({
      lastSeqByTopic: { ...state.lastSeqByTopic, [topic]: seq },
    }));
  },
  recordGap: (topic, reason) => {
    set((state) => ({
      gaps: { ...state.gaps, [topic]: reason },
      lastSeqByTopic:
        reason === "history_lost" ? {} : state.lastSeqByTopic,
    }));
  },
  clearSeqs: () => {
    set({ lastSeqByTopic: {} });
  },
  clearGap: (topic) => {
    set((state) => {
      if (!(topic in state.gaps)) {
        return state;
      }
      const gaps = { ...state.gaps };
      delete gaps[topic];
      return { gaps };
    });
  },
  setReconnectAttempt: (attempt) => {
    set({ reconnectAttempt: attempt });
  },
  setEndpoint: (url) => {
    set({ endpoint: url });
  },
}));
