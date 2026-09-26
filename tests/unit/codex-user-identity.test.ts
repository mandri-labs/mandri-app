import { describe, expect, it } from "vitest";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";
import { transcriptStore } from "@/stores/sessions";
import { withPendingUsers } from "@/features/transcript/optimistic";
import { parseStoredLine } from "@/daemon/ws/storedLine";
import { appendTranscriptNodes, mergeHistoryAndLive } from "@/daemon/ws/transcriptMerge";

const history = (turn: string, text = "Hello", kind = "user.text") => parseCodexHistoryLine(JSON.stringify({
  type: "response_item", payload: { type: "message", role: "user", id: `stored-${turn}`,
    content: [{ type: "input_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: [kind] },
  },
}), "codex");
const live = (turn: string) => parseCodexEvent({ method: "item/completed", params: {
  turnId: turn, item: { type: "userMessage", id: `live-${turn}`, content: [{ type: "text", text: "Hello" }] },
}}, "codex");

describe("Codex stored and live user identities", () => {
  it("reconciles the same user turn despite different native message identifiers", () => {
    expect(mergeHistoryAndLive(history("one"), live("one")).filter(node => node.kind === "user")).toHaveLength(1);
  });
  it("preserves repeated prompts from distinct turns", () => {
    expect(mergeHistoryAndLive(history("one"), live("two")).filter(node => node.kind === "user")).toHaveLength(2);
  });
  it("classifies injected environment context as technical content", () => {
    expect(history("one", "<environment_context>synthetic</environment_context>", "environments.environment_context")[0]?.kind).toBe("raw");
    expect(history("one", "<environment_context>synthetic</environment_context>")[0]?.kind).toBe("user");
  });
});


const userEvent = (id: string, text: string) => parseCodexEvent({ method: "item/completed", params: {
  turnId: "shared-turn", item: { type: "userMessage", id, content: [{ type: "text", text }] },
}}, "codex");
const storedUser = (sequence: number, text: string) => parseStoredLine("codex", JSON.stringify({
  timestamp: `2026-01-01T00:00:0${sequence}Z`, type: "response_item",
  payload: { type: "message", role: "user", content: [{ type: "input_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: "shared-turn", content_item_kinds: ["user.text"] },
  },
}));
const response = { kind: "assistant" as const, text: "Working", key: "response" };
const texts = (nodes: readonly { kind: string; text?: string }[]) => nodes.map(node => node.text);

it("keeps the initial prompt and steering in order within the same live turn", () => {
  const initial = userEvent("initial", "Implement the feature");
  const steering = userEvent("steering", "Include the second provider");
  const nodes = appendTranscriptNodes([...initial, response], steering);
  expect(texts(nodes)).toEqual(["Implement the feature", "Working", "Include the second provider"]);
  expect(appendTranscriptNodes(nodes, steering)).toEqual(nodes);
});

it("keeps separate stored messages in the same turn even when their text is identical", () => {
  const nodes = appendTranscriptNodes(storedUser(1, "Continue"), storedUser(2, "Continue"));
  expect(texts(nodes)).toEqual(["Continue", "Continue"]);
});

it.each(["Include the second provider", "Implement the feature"])(
  "reconciles live and stored steering one to one: %s", (steeringText) => {
    const liveNodes = [...userEvent("initial", "Implement the feature"), response, ...userEvent("steering", steeringText)];
    const historyNodes = [...storedUser(1, "Implement the feature"), response, ...storedUser(2, steeringText)];
    const merged = mergeHistoryAndLive(historyNodes, liveNodes);
    expect(texts(merged)).toEqual(["Implement the feature", "Working", steeringText]);
    expect(mergeHistoryAndLive(historyNodes, merged)).toEqual(merged);
  },
);

it("preserves the initial prompt while acknowledging optimistic steering and refreshing history", () => {
  transcriptStore.getState().resetTranscripts();
  const store = transcriptStore.getState();
  const initial = [...userEvent("initial", "Implement the feature"), response];
  store.setNodes("s", initial);
  store.addPendingUser("s", "Include the second provider");
  const nodes = appendTranscriptNodes(initial, userEvent("steering", "Include the second provider"));
  store.setNodes("s", nodes);
  const snapshot = transcriptStore.getState().transcripts.s!;
  expect(snapshot.pendingUsers).toHaveLength(0);
  expect(texts(withPendingUsers(snapshot.nodes, snapshot.pendingUsers!))).toEqual([
    "Implement the feature", "Working", "Include the second provider",
  ]);
  const historyNodes = [...storedUser(1, "Implement the feature"), response, ...storedUser(2, "Include the second provider")];
  store.setNodes("s", mergeHistoryAndLive(historyNodes, nodes), historyNodes);
  expect(transcriptStore.getState().transcripts.s!.localUsers).toHaveLength(0);
  expect(texts(transcriptStore.getState().transcripts.s!.nodes)).toEqual([
    "Implement the feature", "Working", "Include the second provider",
  ]);
});


it("reconciles an image prompt without replacing it with steering", () => {
  const path = "/workspace/attachments/session/files/image.png";
  const text = `Describe this\n\n[image.png](${path})`;
  const initial = parseCodexEvent({ method: "item/completed", params: {
    turnId: "shared-turn", item: { type: "userMessage", id: "image-prompt", content: [
      { type: "text", text }, { type: "localImage", path },
    ] },
  } }, "codex");
  const stored = parseStoredLine("codex", JSON.stringify({ type: "response_item", payload: {
    type: "message", role: "user", content: [
      { type: "input_text", text },
      { type: "input_text", text: `<image name=[Image #1] path="${path}">` },
      { type: "input_image", image_url: "data:image/png;base64,iVBORw==" },
      { type: "input_text", text: "</image>" },
    ], internal_chat_message_metadata_passthrough: { turn_id: "shared-turn", content_item_kinds: ["user.text", "user.image"] },
  } }));
  const nodes = appendTranscriptNodes([...initial, response], userEvent("steering", "Check the image details"));
  const persisted = [...stored, response, ...storedUser(2, "Check the image details")];
  const merged = mergeHistoryAndLive(persisted, nodes);
  expect(merged).toHaveLength(3);
  expect(merged[0]).toMatchObject({ kind: "user", key: "image-prompt", images: [{ path }] });
  expect(merged[2]).toMatchObject({ kind: "user", text: "Check the image details", key: "steering" });
  expect(mergeHistoryAndLive(persisted, merged)).toEqual(merged);
});


it("does not match a repeated steering message to a prompt before a shared response", () => {
  const historyNodes = [...storedUser(1, "Continue"), response];
  const liveNodes = [response, ...userEvent("steering", "Continue")];
  expect(texts(mergeHistoryAndLive(historyNodes, liveNodes))).toEqual(["Continue", "Working", "Continue"]);
});

it("does not collapse identical prompts from separate history pages", () => {
  expect(texts(mergeHistoryAndLive(storedUser(1, "Continue"), storedUser(2, "Continue")))).toEqual([
    "Continue", "Continue",
  ]);
});
