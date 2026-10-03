import { beforeEach, expect, it } from "vitest";
import { selectDaemon } from "@/daemon/identity";
import { composerStorageKey } from "@/lib/composerStorage";
import { transcriptStore } from "@/stores/sessions";
import { readPendingUsers } from "@/features/transcript/pendingUserStorage";
import { withPendingUsers } from "@/features/transcript/optimistic";
import type { TranscriptNode } from "@/features/transcript/parse/types";

const history: TranscriptNode[] = [{ kind: "assistant", key: "previous", text: "Previous response" }];

beforeEach(() => {
  localStorage.clear();
  selectDaemon("http://localhost:8787");
  transcriptStore.getState().resetTranscripts();
});

it("keeps two unechoed steerings after reload until persisted history confirms each one", () => {
  const store = transcriptStore.getState();
  store.setNodes("session", history, history);
  store.addPendingUser("session", "Remove the spinner");
  store.addPendingUser("session", "Only change the sidebar");
  store.resetTranscripts();
  store.setNodes("session", history, history);
  let transcript = transcriptStore.getState().transcripts.session!;
  expect(withPendingUsers(transcript.nodes, transcript.pendingUsers!)).toMatchObject([
    ...history, { text: "Remove the spinner" }, { text: "Only change the sidebar" },
  ]);
  const echoed: TranscriptNode[] = [...history, { kind: "user", key: "native-1", text: "Remove the spinner" }];
  store.setNodes("session", echoed);
  expect(readPendingUsers("session")).toHaveLength(2);
  store.setNodes("session", echoed, echoed);
  expect(readPendingUsers("session")).toHaveLength(1);
  store.resetTranscripts();
  const persisted: TranscriptNode[] = [...echoed, { kind: "user", key: "native-2", text: "Only change the sidebar" }];
  store.setNodes("session", persisted, persisted);
  transcript = transcriptStore.getState().transcripts.session!;
  expect(transcript.pendingUsers).toEqual([]);
  expect(localStorage.getItem(composerStorageKey("pending", "session"))).toBeNull();
});

it("isolates pending messages by daemon and clears rejected messages", () => {
  const store = transcriptStore.getState();
  const key = store.addPendingUser("session", "Keep this message");
  selectDaemon("http://other:8787");
  store.resetTranscripts();
  store.setNodes("session", []);
  expect(transcriptStore.getState().transcripts.session!.pendingUsers).toEqual([]);
  selectDaemon("http://localhost:8787");
  store.resetTranscripts();
  store.setNodes("session", []);
  expect(transcriptStore.getState().transcripts.session!.pendingUsers).toHaveLength(1);
  store.removePendingUser("session", key);
  store.resetTranscripts();
  store.setNodes("session", []);
  expect(transcriptStore.getState().transcripts.session!.pendingUsers).toEqual([]);
});

it("stores history anchors without copying previous response bodies", () => {
  const store = transcriptStore.getState();
  store.setNodes("session", history);
  store.addPendingUser("session", "A follow-up");
  const saved = localStorage.getItem(composerStorageKey("pending", "session"))!;
  expect(saved).not.toContain("Previous response");
  expect(saved).toContain("previous");
});

it("ignores malformed saved messages", () => {
  localStorage.setItem(composerStorageKey("pending", "session"), JSON.stringify([
    null, { node: { kind: "user", text: 42, key: "bad" }, baseline: [] },
  ]));
  expect(readPendingUsers("session")).toEqual([]);
});
