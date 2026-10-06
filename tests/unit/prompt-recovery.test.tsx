import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { Composer } from "@/features/transcript/Composer";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { composerStorageKey } from "@/lib/composerStorage";
import { readPendingUsers } from "@/features/transcript/pendingUserStorage";
import { attachmentDrafts, filesFor, persistFiles } from "@/features/transcript/attachments";
import { restoreDelivery } from "@/features/transcript/promptDelivery";
import { DaemonError } from "@/daemon/errors";

function mockStorageWrite(setItem: Storage["setItem"]) {
  const storage = localStorage;
  vi.stubGlobal(
    "localStorage",
    new Proxy(storage, {
      get(target, key) {
        if (key === "setItem") return setItem;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  );
}

beforeAll(() => initI18n("en"));
beforeEach(() => {
  localStorage.clear();
  transcriptStore.getState().resetTranscripts();
  attachmentDrafts.setState({ drafts: {}, errors: {} });
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness: "codex",
        title: "Synthetic",
        state: "live",
        deleted: false,
        pendingApprovals: 0,
      },
    },
    drafts: { s1: "Keep this message" },
    order: ["s1"],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not clear or transmit input when the pending message cannot be saved", async () => {
  mockStorageWrite(() => {
    throw new Error("Quota exceeded");
  });
  const feed = { sendPrompt: vi.fn(), interrupt: vi.fn() };
  render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("alert");
  expect(sessionsStore.getState().drafts.s1).toBe("Keep this message");
  expect(feed.sendPrompt).not.toHaveBeenCalled();
  expect(transcriptStore.getState().transcripts.s1?.localUsers ?? []).toHaveLength(0);
});

it("retains a transmitted message through stop and lost acknowledgement, including reload", async () => {
  let reject!: (error: Error) => void;
  const feed = {
    sendPrompt: vi.fn(
      () =>
        new Promise<never>((_, fail) => {
          reject = fail;
        }),
    ),
    interrupt: vi.fn(),
  };
  const view = render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() =>
    sessionsStore.getState().ingestFrame({
      topic: "sessions.all",
      seq: 1,
      ts: 1,
      source: "mandri",
      raw: { type: "session_stopped", session_id: "s1", cause: "crash" },
    }),
  );
  await act(async () =>
    reject(new DaemonError({ code: "delivery_unknown", message: "lost acknowledgement" })),
  );
  expect(readPendingUsers("s1")[0]?.delivery?.state).toBe("unknown");
  view.unmount();
  transcriptStore.getState().resetTranscripts();
  transcriptStore.getState().setNodes("s1", [], []);
  render(<Composer sessionId="s1" feed={feed} />);
  expect(screen.queryByText(/Delivery is not confirmed/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore to composer" })).toBeNull();
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers?.[0]?.node.text).toBe(
    "Keep this message",
  );
  expect(feed.sendPrompt).toHaveBeenCalledTimes(1);
  expect(readPendingUsers("s1")).toHaveLength(1);
});

it("does not discard the retained copy if draft restoration cannot be saved", async () => {
  const key = transcriptStore
    .getState()
    .addPendingUser("s1", "Original", undefined, { content: "Original", state: "not_sent" });
  sessionsStore.getState().setDraft("s1", "New draft");
  const setItem = localStorage.setItem.bind(localStorage);
  mockStorageWrite((key, value) => {
    if (key === composerStorageKey("draft", "s1")) throw new Error("Quota exceeded");
    setItem(key, value);
  });
  expect(await restoreDelivery("s1", key)).toBe(false);
  expect(sessionsStore.getState().drafts.s1).toBe("New draft");
  expect(readPendingUsers("s1")).toHaveLength(1);
  vi.unstubAllGlobals();
  expect(await restoreDelivery("s1", key)).toBe(true);
  expect(sessionsStore.getState().drafts.s1).toBe("Original\n\nNew draft");
  expect(readPendingUsers("s1")).toHaveLength(0);
});

it("restores retained attachment bytes after acknowledgement and reload without replaying", async () => {
  const file = new File([new Uint8Array([0, 1, 255])], "capture.png", { type: "image/png" });
  await persistFiles("delivery:retained", [{ key: "image", file }]);
  const key = transcriptStore.getState().addPendingUser("s1", "Caption", undefined, {
    content: "Caption",
    filesKey: "delivery:retained",
    state: "accepted",
  });
  sessionsStore.getState().setDraft("s1", "New draft");
  transcriptStore.getState().resetTranscripts();
  attachmentDrafts.setState({ drafts: {} });
  transcriptStore.getState().setNodes("s1", [], []);
  expect(await restoreDelivery("s1", key)).toBe(true);
  expect(sessionsStore.getState().drafts.s1).toBe("Caption\n\nNew draft");
  expect(new Uint8Array(await filesFor("s1")[0]!.file.arrayBuffer())).toEqual(
    new Uint8Array([0, 1, 255]),
  );
  expect(localStorage.getItem(composerStorageKey("files", "delivery:retained"))).toBeNull();
});

it("keeps the recovery copy until persisted history confirms the message", () => {
  transcriptStore
    .getState()
    .addPendingUser("s1", "Caption", undefined, { content: "Caption", state: "accepted" });
  const echo = [{ kind: "user" as const, key: "native", text: "Caption" }];
  transcriptStore.getState().setNodes("s1", echo);
  expect(readPendingUsers("s1")).toHaveLength(1);
  transcriptStore.getState().setNodes("s1", echo, echo);
  expect(readPendingUsers("s1")).toHaveLength(0);
});

it("releases retained files when persisted history confirms a message after reload", async () => {
  const filesKey = "delivery:confirmed";
  await persistFiles(filesKey, [{ key: "file", file: new File(["notes"], "notes.txt") }]);
  transcriptStore.getState().addPendingUser("s1", "Caption", undefined, {
    content: "Caption",
    filesKey,
    state: "accepted",
  });
  transcriptStore.getState().resetTranscripts();
  const history = [{ kind: "user" as const, key: "native", text: "Caption" }];
  transcriptStore.getState().setNodes("s1", history, history);
  expect(readPendingUsers("s1")).toHaveLength(0);
  expect(localStorage.getItem(composerStorageKey("files", filesKey))).toBeNull();
});
