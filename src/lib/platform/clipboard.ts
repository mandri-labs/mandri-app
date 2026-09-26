export async function readClipboardImage(): Promise<File | null> {
  const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
  const image = await readImage().catch((error: unknown) => {
    if (
      String(error).includes("The clipboard contents were not available in the requested format")
    ) {
      return null;
    }
    throw error;
  });
  if (!image) return null;
  try {
    const { width, height } = await image.size();
    if (width <= 0 || height <= 0 || width * height > 16_777_216) {
      throw new Error("Clipboard image dimensions exceed the supported limit");
    }
    const rgba = await image.rgba();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable");
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Image conversion failed"))),
        "image/png",
      );
    });
    return new File([blob], "clipboard.png", { type: "image/png" });
  } finally {
    await image.close();
  }
}
