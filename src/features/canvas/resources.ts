import { request } from "@/daemon/rest/client";
export async function readSessionFile(
  sessionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return request<Blob>(`/v1/sessions/${encodeURIComponent(sessionId)}/files`, {
    query: { path },
    responseType: "blob",
    signal,
    timeoutMs: 120_000,
  });
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function imageMime(blob: Blob): Promise<string | undefined> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const text = String.fromCharCode(...bytes);
  if (/^GIF8[79]a/.test(text)) return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8) === "WEBP") return "image/webp";
}
