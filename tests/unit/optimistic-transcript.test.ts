import { beforeEach, expect, it } from "vitest";
import { transcriptStore } from "@/stores/sessions";
import { withPendingUsers } from "@/features/transcript/optimistic";
import { parseFrame, parseHistoryLine } from "@/features/transcript/parse";
import type { TranscriptNode } from "@/features/transcript/parse/types";

beforeEach(() => transcriptStore.getState().resetTranscripts());

const previous: TranscriptNode[] = [
  { kind: "user", text: "Retry", key: "old-user" },
  { kind: "assistant", text: "Previous reply", key: "old-reply" },
];

it("renders a pending message immediately and before a response arriving ahead of its echo", () => {
  const store = transcriptStore.getState();
  store.setNodes("s", previous);
  store.addPendingUser("s", "Retry");
  store.setNodes("s", [...previous, { kind: "assistant", text: "New reply", key: "new-reply" }]);
  const state = transcriptStore.getState().transcripts.s!;
  expect(withPendingUsers(state.nodes, state.pendingUsers!)).toMatchObject([
    ...previous, { kind: "user", text: "Retry" }, { kind: "assistant", text: "New reply" },
  ]);
});

it("does not confuse older history or identical prompts with the new echo", () => {
  const store = transcriptStore.getState();
  store.setNodes("s", previous);
  store.addPendingUser("s", "Retry");
  store.addPendingUser("s", "Retry");
  const older: TranscriptNode = { kind: "user", text: "Retry", key: "older" };
  store.setNodes("s", [older, ...previous]);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(2);
  store.setNodes("s", [older, ...previous, { kind: "user", text: "Retry", key: "new" }]);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(1);
  store.setNodes("s", [older, ...previous, { kind: "user", text: "Retry", key: "new" }]);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(1);
  store.setNodes("s", [older, ...previous, { kind: "user", text: "Retry", key: "new" },
    { kind: "user", text: "Retry", key: "newer" }]);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(0);
});

it("preserves a local message across flag updates and removes it on failure", () => {
  const store = transcriptStore.getState();
  const key = store.addPendingUser("s", "Hello");
  store.setFlags("s", { historyExhausted: true });
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(1);
  store.removePendingUser("s", key);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(0);
});


it("reconciles the first image prompt with Codex live and persisted image wrappers", () => {
  const store = transcriptStore.getState();
  const path = "/workspace/attachments/session/files/image.png";
  const text = `Describe this\n\n[image.png](${path})`;
  const key = store.addPendingUser("s", "Describe this", [{ source: "draft:image", name: "image.png" }]);
  store.updatePendingUser("s", key, text);
  const live = parseFrame("codex", { method: "item/completed", params: {
    turnId: "turn", item: { id: "message", type: "userMessage", content: [
      { type: "text", text }, { type: "localImage", path },
    ] },
  } });
  store.setNodes("s", live);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(0);
  const persisted = parseHistoryLine("codex", JSON.stringify({ type: "response_item", payload: {
    type: "message", role: "user", content: [
      { type: "input_text", text },
      { type: "input_text", text: `<image name=[Image #1] path="${path}">` },
      { type: "input_image", image_url: "data:image/png;base64,iVBORw==" },
      { type: "input_text", text: "</image>" },
    ],
    internal_chat_message_metadata_passthrough: { turn_id: "turn", content_item_kinds: ["user.text", "user.image"] },
  } }));
  store.setNodes("s", persisted, persisted);
  const state = transcriptStore.getState().transcripts.s!;
  expect(state.localUsers).toHaveLength(0);
  expect(withPendingUsers(state.nodes, state.pendingUsers!)).toEqual(persisted);
});

it("does not consume a prompt carrying a different image with the same caption", () => {
  const store = transcriptStore.getState();
  store.addPendingUser("s", "Describe this\n\n[a.png](/files/a.png)");
  store.setNodes("s", [{ kind: "user", text: "Describe this", images: [{ source: "/files/b.png" }] }]);
  expect(transcriptStore.getState().transcripts.s?.pendingUsers).toHaveLength(1);
});

it("keeps the original insertion boundary when upload completes after another event", () => {
  const store = transcriptStore.getState();
  store.setNodes("s", previous);
  const key = store.addPendingUser("s", "Describe this");
  const response: TranscriptNode = { kind: "assistant", text: "Working", key: "response" };
  store.setNodes("s", [...previous, response]);
  store.updatePendingUser("s", key, "Describe this\n\n[image.png](/files/image.png)");
  const state = transcriptStore.getState().transcripts.s!;
  expect(withPendingUsers(state.nodes, state.pendingUsers!)).toMatchObject([
    ...previous, { kind: "user", key }, response,
  ]);
});
