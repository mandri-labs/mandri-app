import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  composerStorageKey,
  readSessionDrafts,
  writeComposerStorage,
  writeSessionDraft,
} from "@/lib/composerStorage";
import { selectDaemon } from "@/daemon/identity";
import { sessionsStore } from "@/stores/sessions";
import { Composer } from "@/features/transcript/Composer";
import {
  attachmentDrafts,
  filesFor,
  removeFiles,
  restoreFiles,
  setFiles,
} from "@/features/transcript/attachments";
import { initI18n } from "@/i18n";

beforeAll(() => initI18n("en"));
beforeEach(() => {
  localStorage.clear();
  selectDaemon("http://127.0.0.1:8787");
  sessionsStore.setState({ drafts: {}, sessions: {} });
  attachmentDrafts.setState({ drafts: {}, errors: {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

it("restores text after navigation and a storage reload, isolated by session and daemon", () => {
  const view = render(<Composer sessionId="one" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsent text\nnext line" } });
  view.rerender(<Composer sessionId="two" />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Other prompt" } });
  view.unmount();
  sessionsStore.setState({ drafts: readSessionDrafts() });
  render(<Composer sessionId="one" />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Unsent text\nnext line");
  act(() => selectDaemon("http://other:8787"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  act(() => selectDaemon("http://127.0.0.1:8787"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Unsent text\nnext line");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  expect(readSessionDrafts()).toEqual({ two: "Other prompt" });
});

it("restores image bytes and metadata from storage and persists removal", async () => {
  const file = new File([new Uint8Array([0, 1, 128, 255])], "picture.png", {
    type: "image/png",
    lastModified: 1234,
  });
  setFiles("one", [{ key: "image", file }]);
  await waitFor(() =>
    expect(localStorage.getItem(composerStorageKey("files", "one"))).not.toBeNull(),
  );
  attachmentDrafts.setState({ drafts: {} });
  restoreFiles("one");
  const restored = filesFor("one")[0]!;
  expect(restored.file.name).toBe(file.name);
  expect(restored.file.type).toBe(file.type);
  expect(restored.file.lastModified).toBe(1234);
  expect(new Uint8Array(await restored.file.arrayBuffer())).toEqual(
    new Uint8Array([0, 1, 128, 255]),
  );
  expect(filesFor("two")).toEqual([]);
  removeFiles("one", [restored]);
  attachmentDrafts.setState({ drafts: {} });
  expect(filesFor("one")).toEqual([]);
});

it("does not resurrect an image removed while its serialization is pending", async () => {
  setFiles("one", [{ key: "image", file: new File(["image"], "picture.png") }]);
  setFiles("one", []);
  // Wait for FileReader's task and the Promise continuation.
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(localStorage.getItem(composerStorageKey("files", "one"))).toBeNull();
});

it("tolerates corrupt or unavailable storage", () => {
  localStorage.setItem(composerStorageKey("text"), "invalid JSON");
  expect(readSessionDrafts()).toEqual({});
  mockStorageWrite(() => {
    throw new Error("Quota exceeded");
  });
  expect(() => sessionsStore.getState().setDraft("one", "Still editable")).not.toThrow();
  expect(sessionsStore.getState().drafts.one).toBe("Still editable");
});

it("saves only the edited session even with many other drafts", () => {
  sessionsStore.setState({
    drafts: Object.fromEntries(
      Array.from({ length: 150 }, (_, index) => [
        String(index),
        "Large unrelated draft".repeat(500),
      ]),
    ),
  });
  const write = vi.fn(localStorage.setItem.bind(localStorage));
  mockStorageWrite(write);
  sessionsStore.getState().setDraft("one", "Edited text");
  expect(write).toHaveBeenCalledExactlyOnceWith(
    composerStorageKey("draft", "one"),
    JSON.stringify("Edited text"),
  );
  expect(sessionsStore.getState().drafts["149"]).toBe("Large unrelated draft".repeat(500));
});

it("migrates legacy drafts and preserves edits and deletions after an interrupted migration", () => {
  const key = composerStorageKey("text");
  writeComposerStorage(key, { one: "Legacy one", two: "Legacy two", invalid: 12 });
  const nativeWrite = localStorage.setItem.bind(localStorage);
  mockStorageWrite((storageKey, value) => {
    if (storageKey === composerStorageKey("draft", "two")) throw new Error("Storage unavailable");
    nativeWrite(storageKey, value);
  });
  expect(readSessionDrafts()).toEqual({ one: "Legacy one", two: "Legacy two" });
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(localStorage.getItem(composerStorageKey("draft", "one"))).toBeNull();
  vi.unstubAllGlobals();
  writeSessionDraft("one", "");
  writeSessionDraft("two", "Newer text");
  expect(readSessionDrafts()).toEqual({ two: "Newer text" });
  expect(localStorage.getItem(key)).toBeNull();
  expect(readSessionDrafts()).toEqual({ two: "Newer text" });
});

it("ignores malformed storage without hiding valid drafts", () => {
  writeComposerStorage(composerStorageKey("text"), []);
  writeComposerStorage(`${composerStorageKey("draft")}%`, "Bad key");
  writeSessionDraft("id:/encoded", "Valid text");
  expect(readSessionDrafts()).toEqual({ "id:/encoded": "Valid text" });
});
