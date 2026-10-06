import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import type { ServerMessage } from "@/daemon/types/ws";
import { asRecord, stringAt } from "@/features/transcript/parse/shared";
import { sessionsStore } from "./sessions";

export interface NativeSessionUi {
  statuses: Record<string, string>;
  widgets: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
}

// Host-native extensions can publish small UI additions without introducing
// harness-specific preferences or interpreting arbitrary terminal components.
export const nativeSessionUiStore = createStore<{ sessions: Record<string, NativeSessionUi> }>(
  () => ({ sessions: {} }),
);
const latestSequence = new Map<string, number>();
daemonIdentity.subscribe(() => {
  latestSequence.clear();
  nativeSessionUiStore.setState({ sessions: {} });
});

export function ingestNativeSessionUi(message: ServerMessage): void {
  if (!("topic" in message) || !message.topic.startsWith("session.") || !("raw" in message)) return;
  const raw = asRecord(message.raw);
  if (!raw) return;
  const sessionId = message.topic.slice("session.".length);
  // Socket replay must not replace text the user has edited since the event.
  if ("seq" in message) {
    if (message.seq <= (latestSequence.get(sessionId) ?? -1)) return;
    latestSequence.set(sessionId, message.seq);
  }
  if (raw.type === "session_info_changed") {
    const title = stringAt(raw, "name");
    if (title) sessionsStore.getState().applySessionPatch(sessionId, { title });
    return;
  }
  if (raw.type === "thinking_level_changed") {
    const reasoningEffort = stringAt(raw, "level");
    if (reasoningEffort) sessionsStore.getState().applySessionPatch(sessionId, { reasoningEffort });
    return;
  }
  if (raw.type !== "extension_ui_request") return;
  if (raw.method === "set_editor_text") {
    const text = stringAt(raw, "text");
    if (text !== undefined) sessionsStore.getState().setDraft(sessionId, text);
    return;
  }
  if (raw.method === "setTitle") {
    const title = stringAt(raw, "title");
    if (title !== undefined) sessionsStore.getState().applySessionPatch(sessionId, { title });
    return;
  }
  if (raw.method !== "setStatus" && raw.method !== "setWidget") return;
  nativeSessionUiStore.setState((state) => {
    const current = state.sessions[sessionId] ?? { statuses: {}, widgets: {} };
    const next = { statuses: { ...current.statuses }, widgets: { ...current.widgets } };
    if (raw.method === "setStatus" && typeof raw.statusKey === "string") {
      if (typeof raw.statusText === "string") next.statuses[raw.statusKey] = raw.statusText;
      else delete next.statuses[raw.statusKey];
    }
    if (raw.method === "setWidget" && typeof raw.widgetKey === "string") {
      if (Array.isArray(raw.widgetLines))
        next.widgets[raw.widgetKey] = {
          lines: raw.widgetLines.filter((line): line is string => typeof line === "string"),
          placement: raw.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
        };
      else delete next.widgets[raw.widgetKey];
    }
    return { sessions: { ...state.sessions, [sessionId]: next } };
  });
}
