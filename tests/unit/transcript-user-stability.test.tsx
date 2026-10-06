import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Transcript } from "@/features/transcript/Transcript";
import { parseFrame, parseHistoryLine } from "@/features/transcript/parse";
import { mergeHistoryAndLive } from "@/daemon/ws/transcriptMerge";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { request } from "@/daemon/rest/client";
import { initI18n } from "@/i18n";

vi.mock("@/daemon/rest/client", () => ({ request: vi.fn() }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; getItemKey: (index: number) => string }) => ({
    getTotalSize: () => options.count * 100,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: options.getItemKey(index),
        start: index * 100,
      })),
    measureElement: () => {},
    scrollToEnd: () => {},
    scrollRect: { height: 800 },
  }),
}));

const feed = { ensureSession: () => {}, loadHistory: async () => {} };
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const path = "/workspace/attachments/session/files/image.png";
const text = `Describe this\n\n[image.png](${path})`;
beforeAll(() => initI18n("en"));
beforeEach(() => {
  sessionsStore.setState(sessionsStore.getInitialState());
  transcriptStore.getState().resetTranscripts();
  transcriptStore.getState().setFlags("s", { historyExhausted: true });
  vi.mocked(request).mockResolvedValue(new Blob([bytes]));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(request).mockReset();
});

it("keeps the same text bubble when the server confirms a local message", () => {
  const store = transcriptStore.getState();
  const localKey = store.addPendingUser("s", "Hello");
  const view = render(<Transcript sessionId="s" harness="codex" feed={feed} />);
  const bubble = view.container.querySelector(".tr-user-bubble");
  act(() => store.setNodes("s", [{ kind: "user", text: "Hello", key: "echo" }]));
  expect(view.container.querySelector(".tr-user-bubble")).toBe(bubble);
  act(() =>
    store.setNodes(
      "s",
      [{ kind: "user", text: "Hello", key: "echo" }],
      [{ kind: "user", text: "Hello", key: "echo" }],
    ),
  );
  expect(view.container.querySelector(".tr-user-bubble")).toBe(bubble);
  expect(transcriptStore.getState().transcripts.s!.nodes[0]!.key).toBe("echo");
  expect(transcriptStore.getState().transcripts.s!.nodes[0]!.key).not.toBe(localKey);
});

it("keeps identical submissions distinct from older history and from each other", () => {
  const store = transcriptStore.getState();
  const older = { kind: "user", text: "Retry", key: "older" } as const;
  store.setNodes("s", [older]);
  store.addPendingUser("s", "Retry");
  store.addPendingUser("s", "Retry");
  const view = render(<Transcript sessionId="s" harness="codex" feed={feed} />);
  const bubbles = [...view.container.querySelectorAll(".tr-user-bubble")];
  const first = { kind: "user", text: "Retry", key: "first" } as const;
  act(() => store.setNodes("s", [older, first]));
  const second = { kind: "user", text: "Retry", key: "second" } as const;
  act(() => store.setNodes("s", [older, first, second], [older, first, second]));
  const after = [...view.container.querySelectorAll(".tr-user-bubble")];
  expect(after).toHaveLength(3);
  after.forEach((bubble, index) => expect(bubble).toBe(bubbles[index]));
});

it("releases the local preview when the server changes the image content", async () => {
  const store = transcriptStore.getState();
  const key = store.addPendingUser("s", "Describe this", [
    {
      source: "draft:image",
      name: "image.png",
      file: new File([bytes], "image.png", { type: "image/png" }),
    },
  ]);
  store.updatePendingUser("s", key, text);
  store.setNodes("s", [{ kind: "user", text, key: "echo" }], [{ kind: "user", text, key: "echo" }]);
  const view = render(<Transcript sessionId="s" harness="codex" feed={feed} />);
  await waitFor(() => expect(view.container.querySelector(".tr-user-bubble img")).not.toBeNull());
  const bubble = view.container.querySelector(".tr-user-bubble");
  act(() =>
    store.setNodes("s", [
      { kind: "user", text: "Describe this", key: "echo", images: [{ source: "/different.png" }] },
    ]),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/v1/sessions/s/files",
      expect.objectContaining({ query: { path: "/different.png" } }),
    ),
  );
  expect(view.container.querySelector(".tr-user-bubble")).toBe(bubble);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

it("keeps the decoded local thumbnail through upload, live echo and repeated history refresh", async () => {
  const store = transcriptStore.getState();
  const key = store.addPendingUser("s", "Describe this", [
    {
      source: "draft:image",
      name: "image.png",
      file: new File([bytes], "image.png", { type: "image/png" }),
    },
  ]);
  const view = render(<Transcript sessionId="s" harness="codex" feed={feed} />);
  await waitFor(() => expect(view.container.querySelector(".tr-user-bubble img")).not.toBeNull());
  const bubble = view.container.querySelector(".tr-user-bubble");
  const image = view.container.querySelector(".tr-user-bubble img");
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(bubble!, { childList: true, subtree: true });
  act(() => store.updatePendingUser("s", key, text));
  expect(view.container.querySelector(".tr-user-bubble img")).toBe(image);
  const live = parseFrame("codex", {
    method: "item/completed",
    params: {
      turnId: "turn",
      item: {
        id: "message",
        type: "userMessage",
        content: [
          { type: "text", text },
          { type: "localImage", path },
        ],
      },
    },
  });
  act(() => store.setNodes("s", live));
  expect(view.container.querySelector(".tr-user-bubble")).toBe(bubble);
  expect(view.container.querySelector(".tr-user-bubble img")).toBe(image);
  const historyLine = JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text },
        { type: "input_text", text: `<image name=[Image #1] path="${path}">` },
        { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=" },
        { type: "input_text", text: "</image>" },
      ],
      internal_chat_message_metadata_passthrough: {
        turn_id: "turn",
        content_item_kinds: ["user.text", "user.image"],
      },
    },
  });
  for (let refresh = 0; refresh < 2; refresh++) {
    const history = parseHistoryLine("codex", historyLine);
    act(() => store.setNodes("s", mergeHistoryAndLive(history, live), history));
    expect(view.container.querySelector(".tr-user-bubble")).toBe(bubble);
    expect(view.container.querySelector(".tr-user-bubble img")).toBe(image);
  }
  await act(async () => {});
  expect([...mutations, ...observer.takeRecords()]).toHaveLength(0);
  observer.disconnect();
  expect(request).not.toHaveBeenCalled();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(transcriptStore.getState().transcripts.s!.localUsers).toHaveLength(0);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview");
});
