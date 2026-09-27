import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserBubble } from "@/features/transcript/renderers/UserBubble";
import { userImages, contentImages } from "@/features/transcript/parse/images";
import { parseFrame, parseHistoryLine } from "@/features/transcript/parse";
import { request } from "@/daemon/rest/client";
import { initI18n } from "@/i18n";

vi.mock("@/daemon/rest/client", () => ({ request: vi.fn() }));
const data = "data:image/png;base64,iVBORw0KGgo=";
beforeAll(async () => {
  await initI18n("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(request).mockReset();
});

it("extracts two Codex image wrappers and deduplicates their attachment links", () => {
  const text =
    'Compare\n[a](/a.png)\n[b](/b.png)<image name=[Image #1] path="/a.png"></image><image name=[Image #2] path="/b.png">\n</image>';
  expect(userImages(text)).toEqual({
    text: "Compare",
    images: [
      { source: "/a.png", name: "a" },
      { source: "/b.png", name: "b" },
    ],
  });
});
it("preserves ordinary text and unresolved partial wrappers", () => {
  expect(userImages('  hello <image name=[Image #1] path="/missing.png">').text).toBe(
    '  hello <image name=[Image #1] path="/missing.png">',
  );
});
it("preserves Codex live localImage and image-only history", () => {
  expect(
    parseFrame("codex", {
      method: "item/completed",
      params: {
        item: { type: "userMessage", id: "u", content: [{ type: "localImage", path: "/a.png" }] },
      },
    }),
  ).toMatchObject([{ kind: "user", text: "", images: [{ source: "/a.png" }] }]);
  expect(
    parseHistoryLine(
      "codex",
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: data }],
        },
      }),
    ),
  ).toMatchObject([{ kind: "user", text: "", images: [{ source: data }] }]);
});
it("associates Codex stored bytes with the surrounding local path", () => {
  const images = contentImages([
    { type: "input_text", text: '<image name=[Image #1] path="/a.png">' },
    { type: "input_image", image_url: data },
    { type: "input_text", text: "</image>" },
  ]);
  expect(userImages('<image name=[Image #1] path="/a.png">\n</image>', images).images).toEqual([
    { source: data, path: "/a.png", name: undefined },
  ]);
});
it("keeps Claude base64 images in the user bubble", () => {
  expect(
    parseFrame("claude", {
      type: "user",
      uuid: "u",
      message: {
        content: [
          { type: "text", text: "Caption" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
          },
        ],
      },
    }),
  ).toMatchObject([{ kind: "user", text: "Caption", images: [{ source: data }] }]);
});
it("keeps OpenCode image file parts", () => {
  expect(
    parseFrame("opencode", {
      type: "message.part.updated",
      properties: {
        part: { type: "file", id: "p", mime: "image/png", url: data, filename: "capture.png" },
      },
    }),
  ).toMatchObject([{ kind: "user", images: [{ source: data, name: "capture.png" }] }]);
});
it("loads optimistic links from the daemon and releases preview URLs", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.mocked(request).mockResolvedValue(
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]),
  );
  const view = render(
    <UserBubble sessionId="s" text="Caption\n[image.png](/workspace/image.png)" />,
  );
  await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe("blob:preview"));
  expect(request).toHaveBeenCalledWith(
    "/v1/sessions/s/files",
    expect.objectContaining({ query: { path: "/workspace/image.png" }, responseType: "blob" }),
  );
  expect(create).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:preview");
});
it("does not display fabricated previews for missing files", async () => {
  vi.mocked(request).mockRejectedValue(new Error("404"));
  render(<UserBubble sessionId="s" text="[missing.png](/missing.png)" />);
  await screen.findByText("Image unavailable");
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByRole("button", { name: "missing.png Image unavailable" })).toBeTruthy();
});
it("shows unavailable if the browser cannot decode embedded bytes", async () => {
  render(<UserBubble text="" images={[{ source: data }]} />);
  fireEvent.error(await screen.findByRole("img"));
  expect(screen.getByText("Image unavailable")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
});

it("normalizes OpenCode local file URLs", () => {
  expect(
    contentImages([{ type: "file", mime: "image/png", url: "file:///workspace/a%20b.png" }]),
  ).toEqual([{ source: "/workspace/a b.png" }]);
});
it("does not merge different OpenCode user messages", async () => {
  const { presentTranscript } = await import("@/features/transcript/presentation");
  const nodes = presentTranscript([
    {
      kind: "user",
      text: "[image.png](/home/worker/mandri-attachments/id/image.png)",
      messageId: "one",
    },
    { kind: "user", text: "", images: [{ source: data }], messageId: "one" },
    { kind: "user", text: "Next", messageId: "two" },
  ]);
  expect(nodes).toHaveLength(2);
  const first = nodes[0];
  expect(first?.kind).toBe("user");
  if (first?.kind === "user") expect(userImages(first.text, first.images).images).toHaveLength(1);
});

it("renders Windows native paths and attachment references as the same two images", () => {
  const text = "Voici les captures en question\n\n[one.png](C:/Dev%20Drive/mandri-attachments/one/one.png)\n[two.png](C:/Dev%20Drive/mandri-attachments/two/two.png)";
  const images = [
    { source: "c:\\Dev Drive\\mandri-attachments\\one\\one.png" },
    { source: "C:\\Dev Drive\\mandri-attachments\\two\\two.png" },
  ];
  const content = userImages(text, images);
  expect(content.text).toBe("Voici les captures en question");
  expect(content.images).toHaveLength(2);
  expect(content.images.map((image) => image.name)).toEqual(["one.png", "two.png"]);
});
