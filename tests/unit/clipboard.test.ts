import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { readClipboardImage } from "@/lib/platform/clipboard";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import capabilities from "../../src-tauri/capabilities/default.json";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readImage: vi.fn() }));

it("permits local image previews and only grants clipboard image reads", () => {
  const imagePolicy = tauriConfig.app.security.csp
    .split(";")
    .find((rule) => rule.trim().startsWith("img-src "));
  expect(imagePolicy?.trim().split(/\s+/)).toContain("blob:");
  expect(
    capabilities.permissions.filter((permission) => permission.startsWith("clipboard-manager:")),
  ).toEqual(["clipboard-manager:allow-read-image"]);
});

beforeEach(() => {
  vi.mocked(readImage).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function clipboardImage(width = 1, height = 1) {
  const image = {
    size: vi.fn(async () => ({ width, height })),
    rgba: vi.fn(async () => new Uint8Array([255, 0, 0, 255])),
    close: vi.fn(async () => undefined),
  };
  vi.mocked(readImage).mockResolvedValue(image as unknown as Awaited<ReturnType<typeof readImage>>);
  return image;
}

it("ignores a clipboard containing no image", async () => {
  vi.mocked(readImage).mockRejectedValue(
    "The clipboard contents were not available in the requested format or the clipboard is empty.",
  );
  expect(await readClipboardImage()).toBeNull();
});

it("does not hide native clipboard access errors", async () => {
  vi.mocked(readImage).mockRejectedValue(new Error("Access denied"));
  await expect(readClipboardImage()).rejects.toThrow("Access denied");
});

it("encodes native RGBA pixels as a PNG file and releases the image resource", async () => {
  const image = clipboardImage();
  const putImageData = vi.fn();
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["encoded-png"], { type: "image/png" }));
  });
  const file = await readClipboardImage();
  expect(file?.name).toBe("clipboard.png");
  expect(file?.type).toBe("image/png");
  expect(file?.size).toBe(11);
  expect(putImageData).toHaveBeenCalledWith(
    expect.objectContaining({
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
    }),
    0,
    0,
  );
  expect(image.close).toHaveBeenCalledOnce();
});

it("releases the native resource if conversion fails", async () => {
  const image = clipboardImage();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await expect(readClipboardImage()).rejects.toThrow("Image conversion is unavailable");
  expect(image.close).toHaveBeenCalledOnce();
});

it("rejects oversized images before transferring their pixels", async () => {
  const image = clipboardImage(8192, 8192);
  await expect(readClipboardImage()).rejects.toThrow("dimensions");
  expect(image.rgba).not.toHaveBeenCalled();
  expect(image.close).toHaveBeenCalledOnce();
});
