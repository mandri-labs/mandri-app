import { asArray, asRecord, stringAt } from "./shared";

export interface TranscriptImage {
  source: string;
  file?: File;
  name?: string;
  path?: string;
}

const localTag = /<image\s+name=(?:\[[^\]]*\]|"[^"]*")\s+path="([^\n]+?)"\s*>/;

export function contentImages(content: unknown): TranscriptImage[] {
  const images: TranscriptImage[] = [];
  let path: string | undefined;
  for (const value of asArray(content) ?? []) {
    const block = asRecord(value);
    const type = stringAt(block, "type");
    const text = stringAt(block, "text");
    if (text) {
      path = localTag.exec(text)?.[1] ?? path;
      if (text.includes("</image>")) path = undefined;
    }
    let source: string | undefined;
    if (type === "localImage") source = stringAt(block, "path") ?? "";
    if (type === "input_image") source = stringAt(block, "image_url") ?? path ?? "";
    if (type === "file" && stringAt(block, "mime")?.startsWith("image/"))
      source = stringAt(block, "url") ?? "";
    if (type === "image") {
      const data = asRecord(block?.["source"]);
      source =
        data?.["type"] === "base64"
          ? `data:${stringAt(data, "media_type")};base64,${stringAt(data, "data") ?? ""}`
          : (stringAt(data, "url") ?? stringAt(block, "url") ?? (stringAt(block, "data") && stringAt(block, "mimeType") ? `data:${stringAt(block, "mimeType")};base64,${stringAt(block, "data")}` : ""));
    }
    if (source?.startsWith("file://")) {
      try {
        const url = new URL(source);
        if (!url.host || url.host === "localhost")
          source = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
      } catch {
        source = "";
      }
    }
    if (source !== undefined)
      images.push({
        source,
        ...(path ? { path } : {}),
        ...(stringAt(block, "filename") ? { name: stringAt(block, "filename") } : {}),
      });
  }
  return images;
}

export function userImages(text: string, images: readonly TranscriptImage[] = []) {
  const found = images.map((image) => ({ ...image }));
  const references: TranscriptImage[] = [];
  const add = (source: string, name?: string) => {
    const existing = references.find((image) => image.source === source);
    if (existing) existing.name ??= name;
    else references.push({ source, name });
  };
  let cleaned = text.replace(
    /<image\s+name=(?:\[[^\]]*\]|"[^"]*")\s+path="([^\n]+?)"\s*>\s*<\/image>/g,
    (_, path: string) => {
      add(path);
      return "";
    },
  );
  cleaned = cleaned.replace(
    /!?\[([^\]\n]*)\]\(([^)\n]+)\)/g,
    (match, name: string, href: string) => {
      let path: string;
      try {
        path = decodeURIComponent(href);
      } catch {
        return match;
      }
      if (
        !/\.(?:png|jpe?g|gif|webp)$/i.test(path) ||
        (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
      )
        return match;
      add(path, name);
      return "";
    },
  );
  const uploaded = references.filter((image) =>
    /\/(?:mandri-attachments\/|attachments\/[^/]+\/files\/)/.test(image.source),
  );
  if (uploaded.length === found.length) {
    for (const [index, image] of found.entries()) {
      if (!image.path && image.source.startsWith("data:image/"))
        image.path = uploaded[index]?.source;
    }
  }
  for (const reference of references) {
    const existing = found.find(
      (image) => image.source === reference.source || image.path === reference.source,
    );
    if (existing) existing.name ??= reference.name;
    else found.push(reference);
  }
  return { text: cleaned === text ? text : cleaned.trim(), images: found };
}
