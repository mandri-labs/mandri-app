import { CanvasLayout } from "@/features/canvas/CanvasLayout";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DaemonError } from "@/daemon/errors";
import { Composer } from "@/features/transcript/Composer";
import { UserBubble } from "@/features/transcript/renderers/UserBubble";
import { MarkdownText } from "@/features/transcript/renderers/MarkdownText";
import { attachmentDrafts, filesFor, uploadFiles } from "@/features/transcript/attachments";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { request } from "@/daemon/rest/client";
import { selectDaemon } from "@/daemon/identity";
import { initI18n } from "@/i18n";
import * as platform from "@/lib/platform";
import { readClipboardImage } from "@/lib/platform/clipboard";

vi.mock("@/lib/platform/clipboard", () => ({ readClipboardImage: vi.fn() }));

vi.mock("@/daemon/rest/client", async (original) => ({
  ...(await original<typeof import("@/daemon/rest/client")>()),
  request: vi.fn(),
}));

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(platform, "isTauri").mockReturnValue(false);
  vi.mocked(readClipboardImage).mockReset().mockResolvedValue(null);
  attachmentDrafts.setState({ drafts: {}, errors: {} });
  transcriptStore.getState().resetTranscripts();
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness: "claude",
        state: "live",
        title: "Session",
        deleted: false,
        pendingApprovals: 0,
      },
    },
    order: ["s1"],
    drafts: {},
  });
  vi.mocked(request).mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uploads selected bytes before sending references and retains a visible file-only message", async () => {
  vi.mocked(request).mockResolvedValue({
    id: "attachment",
    name: "notes.txt",
    size: 5,
    media_type: "application/octet-stream",
    reference: "[notes.txt](/files/notes.txt)",
  });
  const feed = {
    sendPrompt: vi.fn(async () => ({ state: "queued" as const, code: null })),
    interrupt: vi.fn(),
  };
  render(<Composer sessionId="s1" feed={feed} />);
  expect(screen.getByRole("button", { name: "Add files" })).toBeTruthy();
  const file = new File(["notes"], "notes.txt", { type: "text/plain" });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  expect(screen.getByText("notes.txt")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(feed.sendPrompt).toHaveBeenCalledWith("s1", "", ["attachment"]));
  expect(request).toHaveBeenCalledWith(
    "/v1/sessions/s1/attachments",
    expect.objectContaining({ rawBody: file, query: { name: "notes.txt" } }),
  );
  expect(transcriptStore.getState().transcripts.s1?.pendingUsers?.[0]?.node.text).toBe(
    "[notes.txt](/files/notes.txt)",
  );
  expect(filesFor("s1")).toHaveLength(0);
});

it("keeps text and files when upload fails without invoking the harness", async () => {
  vi.mocked(request).mockRejectedValue(new Error("Upload failed"));
  const feed = { sendPrompt: vi.fn(), interrupt: vi.fn() };
  render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "caption" } });
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(["notes"], "notes.txt")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Upload failed");
  expect(feed.sendPrompt).not.toHaveBeenCalled();
  expect(filesFor("s1")).toHaveLength(1);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("caption");
});

it("accepts clipboard image bytes while preserving mixed text paste", () => {
  render(<Composer sessionId="s1" />);
  const file = new File(["png"], "clipboard.png", { type: "image/png" });
  const clipboardData = {
    items: [{ kind: "file", getAsFile: () => file }],
    getData: () => "caption",
  };
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  fireEvent(screen.getByRole("textbox"), event);
  expect(event.defaultPrevented).toBe(false);
  expect(filesFor("s1")[0]?.file).toBe(file);
  expect(screen.getByText("clipboard.png")).toBeTruthy();
});

it("accepts clipboard files when the WebView exposes no file items", () => {
  render(<Composer sessionId="s1" />);
  const file = new File(["png"], "capture.png", { type: "image/png" });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { items: [], files: [file], getData: () => "" },
  });
  fireEvent(screen.getByRole("textbox"), event);
  expect(event.defaultPrevented).toBe(true);
  expect(filesFor("s1")[0]?.file).toBe(file);
  expect(readClipboardImage).not.toHaveBeenCalled();
});

it.each([{ ctrlKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true }])(
  "reads native images on desktop paste shortcuts %j without consuming text paste",
  async (modifiers) => {
    vi.mocked(platform.isTauri).mockReturnValue(true);
    const file = new File(["png"], "clipboard.png", { type: "image/png" });
    vi.mocked(readClipboardImage).mockResolvedValue(file);
    render(<Composer sessionId="s1" />);
    expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ...modifiers })).toBe(true);
    await waitFor(() => expect(filesFor("s1")[0]?.file).toBe(file));
    expect(readClipboardImage).toHaveBeenCalledTimes(1);
  },
);

it("does not duplicate an image supplied by the browser after a paste shortcut", async () => {
  vi.mocked(platform.isTauri).mockReturnValue(true);
  const file = new File(["png"], "clipboard.png", { type: "image/png" });
  vi.mocked(readClipboardImage).mockResolvedValue(file);
  render(<Composer sessionId="s1" />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ctrlKey: true });
  fireEvent.paste(screen.getByRole("textbox"), {
    clipboardData: { items: [{ kind: "file", getAsFile: () => file }], getData: () => "" },
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(filesFor("s1")).toHaveLength(1);
  expect(readClipboardImage).not.toHaveBeenCalled();
});

it("falls back for a desktop paste event without image items", async () => {
  vi.mocked(platform.isTauri).mockReturnValue(true);
  const file = new File(["png"], "clipboard.png", { type: "image/png" });
  vi.mocked(readClipboardImage).mockResolvedValue(file);
  render(<Composer sessionId="s1" />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ctrlKey: true });
  expect(
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { items: [], files: [], getData: () => "caption" },
    }),
  ).toBe(true);
  await waitFor(() => expect(filesFor("s1")).toHaveLength(1));
  expect(readClipboardImage).toHaveBeenCalledTimes(1);
});

it("discards native clipboard results after the composer unmounts", async () => {
  vi.mocked(platform.isTauri).mockReturnValue(true);
  let finish!: (file: File) => void;
  vi.mocked(readClipboardImage).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<Composer sessionId="s1" />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ctrlKey: true });
  await waitFor(() => expect(readClipboardImage).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => {
    finish(new File(["png"], "clipboard.png", { type: "image/png" }));
  });
  expect(filesFor("s1")).toHaveLength(0);
});

it("accepts native clipboard images in surrogate sessions", async () => {
  vi.mocked(platform.isTauri).mockReturnValue(true);
  sessionsStore.getState().applySessionPatch("s1", { privacyMode: "surrogate" });
  vi.mocked(readClipboardImage).mockResolvedValue(
    new File(["png"], "clipboard.png", { type: "image/png" }),
  );
  render(<Composer sessionId="s1" />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ctrlKey: true });
  await screen.findByText("clipboard.png");
  expect(filesFor("s1")[0]?.file.type).toBe("image/png");
});

it("does not read the native clipboard in a browser", async () => {
  render(<Composer sessionId="s1" />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ctrlKey: true });
  fireEvent.paste(screen.getByRole("textbox"), {
    clipboardData: { items: [], getData: () => "text" },
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(readClipboardImage).not.toHaveBeenCalled();
});

it("shows a native clipboard failure without discarding the draft", async () => {
  vi.mocked(platform.isTauri).mockReturnValue(true);
  vi.mocked(readClipboardImage).mockRejectedValue(new Error("Access denied"));
  render(<Composer sessionId="s1" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "caption" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ctrlKey: true });
  await screen.findByText("Could not paste the image. Try adding it as a file.");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("caption");
  expect(filesFor("s1")).toHaveLength(0);
});

it("does not read the native clipboard when attachments are disabled", async () => {
  vi.mocked(platform.isTauri).mockReturnValue(true);
  sessionsStore.getState().applySessionPatch("s1", { harness: "agy" });
  render(<Composer sessionId="s1" />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "v", ctrlKey: true });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(readClipboardImage).not.toHaveBeenCalled();
});

it("rejects Agy attachments and accepts surrogate images on supported harnesses", () => {
  sessionsStore.getState().applySessionPatch("s1", { harness: "agy" });
  const view = render(<Composer sessionId="s1" />);
  expect((screen.getByRole("button", { name: "Add files" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  act(() =>
    sessionsStore
      .getState()
      .applySessionPatch("s1", { harness: "claude", privacyMode: "surrogate" }),
  );
  view.rerender(<Composer sessionId="s1" />);
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(["png"], "image.png", { type: "image/png" })] },
  });
  expect(screen.getByText("image.png")).toBeTruthy();
  expect(filesFor("s1")).toHaveLength(1);
});

it("reuses completed uploads on retry but never across daemon changes", async () => {
  vi.mocked(request).mockResolvedValue({ id: "attachment", reference: "file" });
  const selected = [{ key: "key", file: new File(["notes"], "notes.txt") }];
  await uploadFiles("s1", selected);
  await uploadFiles("s1", selected);
  expect(request).toHaveBeenCalledTimes(1);
  selectDaemon("http://different-daemon.invalid");
  await uploadFiles("s1", selected);
  expect(request).toHaveBeenCalledTimes(2);
  selectDaemon("http://127.0.0.1:8787");
});

it("resolves local markdown links through the session daemon without navigating to the frontend path", async () => {
  vi.mocked(request).mockRejectedValue(new Error("unavailable"));
  render(
    <CanvasLayout sessionId="s1">
      <MarkdownText sessionId="s1" text="[Report](/project/report.md:12)" />
    </CanvasLayout>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Report" }));
  await screen.findByText("File unavailable in this session context.");
  expect(request).toHaveBeenCalledWith(
    "/v1/sessions/s1/files",
    expect.objectContaining({ query: { path: "/project/report.md" }, responseType: "blob" }),
  );
});

it("uploads and sends image bytes from a surrogate session", async () => {
  sessionsStore.getState().applySessionPatch("s1", { privacyMode: "surrogate" });
  vi.mocked(request).mockResolvedValue({
    id: "image-attachment",
    name: "capture.png",
    size: 3,
    media_type: "image/png",
    reference: "[capture.png](/files/capture.png)",
  });
  const feed = {
    sendPrompt: vi.fn(async () => ({ state: "queued" as const, code: null })),
    interrupt: vi.fn(),
  };
  const file = new File(["png"], "capture.png", { type: "image/png" });
  render(<Composer sessionId="s1" feed={feed} />);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(feed.sendPrompt).toHaveBeenCalledWith("s1", "", ["image-attachment"]));
  expect(request).toHaveBeenCalledWith(
    "/v1/sessions/s1/attachments",
    expect.objectContaining({ rawBody: file, query: { name: "capture.png" } }),
  );
  expect(filesFor("s1")).toHaveLength(0);
});

it("puts the local image inside the pending bubble while upload is unresolved", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const feed = {
    sendPrompt: vi.fn(async () => ({ state: "queued" as const, code: null })),
    interrupt: vi.fn(),
  };
  render(<Composer sessionId="s1" feed={feed} />);
  const file = new File([new Uint8Array([137, 80, 78, 71])], "capture.png", { type: "image/png" });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Describe this" } });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(1),
  );
  const node = transcriptStore.getState().transcripts.s1!.pendingUsers![0]!.node;
  expect(node.images?.[0]?.file).toBe(file);
  expect(document.querySelector(".attachment-chips")).toBeNull();
  expect(screen.queryByText("Sending files…")).toBeNull();
  render(<UserBubble text={node.text} images={node.images} sessionId="s1" />);
  await waitFor(() => expect(document.querySelector(".tr-user-bubble img")).not.toBeNull());
  expect(feed.sendPrompt).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => finish({ id: "image", reference: "[capture.png](/files/capture.png)" }));
  await waitFor(() =>
    expect(feed.sendPrompt).toHaveBeenCalledWith("s1", "Describe this", ["image"]),
  );
  expect(transcriptStore.getState().transcripts.s1!.pendingUsers![0]!.node.key).toBe(node.key);
});

it.each(["upload", "prompt"])(
  "retains three attachments and retries once after %s storage failure",
  async (stage) => {
    let failed = false;
    vi.mocked(request).mockImplementation(async (_path, options) => {
      const name = String(options?.query?.name);
      if (stage === "upload" && name === "two.txt" && !failed) {
        failed = true;
        throw new DaemonError({
          code: "attachment_storage_unavailable",
          message: "Session file storage is unavailable",
          httpStatus: 503,
        });
      }
      return {
        id: name,
        name,
        size: 5,
        media_type: "text/plain",
        reference: `[${name}](/files/${name})`,
      };
    });
    const feed = {
      sendPrompt: vi.fn(async () => {
        if (stage === "prompt" && !failed) {
          failed = true;
          throw new DaemonError({
            code: "attachment_storage_unavailable",
            message: "Session file storage is unavailable",
          });
        }
        return { state: "queued" as const, code: null };
      }),
      interrupt: vi.fn(),
    };
    render(<Composer sessionId="s1" feed={feed} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Voici les captures en question" },
    });
    const files = ["one.txt", "two.txt", "three.txt"].map((name) => new File(["notes"], name));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(
      "Attachment storage is temporarily unavailable. Your message and files have been kept.",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("The request was malformed. Please try again.")).toBeNull();
    expect(filesFor("s1").map((item) => item.file)).toEqual(files);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Voici les captures en question",
    );
    expect(transcriptStore.getState().transcripts.s1?.pendingUsers).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(filesFor("s1")).toHaveLength(0));
    expect(request).toHaveBeenCalledTimes(stage === "upload" ? 4 : 3);
    expect(feed.sendPrompt).toHaveBeenLastCalledWith("s1", "Voici les captures en question", [
      "one.txt",
      "two.txt",
      "three.txt",
    ]);
    expect(feed.sendPrompt).toHaveBeenCalledTimes(stage === "upload" ? 1 : 2);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
