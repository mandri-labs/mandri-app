import {
  composerStorageKey,
  readComposerStorage,
  writeComposerStorage,
} from "@/lib/composerStorage";
import { createStore } from "zustand/vanilla";
import { daemonIdentity } from "@/daemon/identity";
import { request } from "@/daemon/rest/client";
import { createDebugLogger } from "@/lib/debug";

const log = createDebugLogger("attachments");

export interface UploadedAttachment {
  id: string;
  name: string;
  media_type: string;
  size: number;
  reference: string;
}

export interface DraftAttachment {
  key: string;
  file: File;
  uploaded?: UploadedAttachment;
  sessionId?: string;
  generation?: number;
}

const empty: DraftAttachment[] = [];
export const attachmentDrafts = createStore(() => ({
  drafts: {} as Record<string, DraftAttachment[]>,
  errors: {} as Record<string, string | null>,
}));

export function setAttachmentError(key: string, error: string | null): void {
  attachmentDrafts.setState(({ errors }) => ({ errors: { ...errors, [key]: error } }));
}

interface StoredAttachment {
  key: string;
  name: string;
  type: string;
  lastModified: number;
  data: string;
}

export function restoreFiles(key: string): void {
  if (attachmentDrafts.getState().drafts[key] !== undefined) return;
  const stored = readComposerStorage<StoredAttachment[]>(composerStorageKey("files", key), []);
  const files: DraftAttachment[] = [];
  if (Array.isArray(stored))
    for (const item of stored) {
      try {
        if (
          typeof item.key !== "string" ||
          typeof item.name !== "string" ||
          typeof item.data !== "string"
        )
          continue;
        const bytes = Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0));
        files.push({
          key: item.key,
          file: new File([bytes], item.name, { type: item.type, lastModified: item.lastModified }),
        });
      } catch {
        /* Ignore malformed stored files. */
      }
    }
  attachmentDrafts.setState(({ drafts }) => ({ drafts: { ...drafts, [key]: files } }));
}

export function filesFor(key: string): DraftAttachment[] {
  restoreFiles(key);
  return attachmentDrafts.getState().drafts[key] ?? empty;
}

const encodedFiles = new WeakMap<File, Promise<string>>();
function encodeFile(file: File): Promise<string> {
  let encoded = encodedFiles.get(file);
  if (!encoded) {
    encoded = new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    encodedFiles.set(file, encoded);
  }
  return encoded;
}

const writes = new Map<string, object>();

export function setFiles(key: string, files: DraftAttachment[]): void {
  attachmentDrafts.setState(({ drafts }) => ({ drafts: { ...drafts, [key]: files } }));
  const storageKey = composerStorageKey("files", key);
  const revision = {};
  writes.set(storageKey, revision);
  if (!files.length) {
    writeComposerStorage(storageKey, null);
    return;
  }
  void Promise.all(
    files.map(async ({ key: fileKey, file }) => ({
      key: fileKey,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      data: await encodeFile(file),
    })),
  )
    .then((stored) => {
      if (writes.get(storageKey) === revision) writeComposerStorage(storageKey, stored);
    })
    .catch(() => {
      /* Keep files in memory if they cannot be persisted. */
    });
}

export function removeFiles(key: string, selected: readonly DraftAttachment[]): void {
  const removed = new Set(selected.map((item) => item.key));
  setFiles(
    key,
    filesFor(key).filter((item) => !removed.has(item.key)),
  );
}

export async function uploadFiles(
  sessionId: string,
  selected: readonly DraftAttachment[],
): Promise<UploadedAttachment[]> {
  const generation = daemonIdentity.getState().generation;
  const result: UploadedAttachment[] = [];
  for (const item of selected) {
    if (daemonIdentity.getState().generation !== generation) throw new Error("Daemon changed");
    if (item.uploaded && item.sessionId === sessionId && item.generation === generation) {
      log.debug("reusing uploaded attachment", { sessionId, attachmentId: item.uploaded.id });
      result.push(item.uploaded);
      continue;
    }
    log.debug("upload started", { sessionId, name: item.file.name, size: item.file.size });
    const uploaded = await request<UploadedAttachment>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/attachments`,
      {
        method: "POST",
        rawBody: item.file,
        query: { name: item.file.name },
        timeoutMs: 120_000,
      },
    );
    if (daemonIdentity.getState().generation !== generation) throw new Error("Daemon changed");
    Object.assign(item, { uploaded, sessionId, generation });
    log.debug("upload completed", { sessionId, attachmentId: uploaded.id, size: uploaded.size });
    result.push(uploaded);
  }
  return result;
}

export function draftMessage(text: string, files: readonly DraftAttachment[]) {
  return {
    text: [
      text,
      ...files.filter(({ file }) => !file.type.startsWith("image/")).map(({ file }) => file.name),
    ]
      .filter(Boolean)
      .join("\n\n"),
    images: files
      .filter(({ file }) => file.type.startsWith("image/"))
      .map(({ key, file }) => ({ source: `draft:${key}`, name: file.name, file })),
  };
}

export function attachmentMessage(text: string, files: readonly UploadedAttachment[]): string {
  return [text, files.map((file) => file.reference).join("\n")].filter(Boolean).join("\n\n");
}

daemonIdentity.subscribe(() => attachmentDrafts.setState({ drafts: {}, errors: {} }));

export async function persistFiles(
  key: string,
  files: readonly DraftAttachment[],
): Promise<boolean> {
  const storageKey = composerStorageKey("files", key);
  const generation = daemonIdentity.getState().generation;
  const revision = {};
  writes.set(storageKey, revision);
  try {
    const stored = await Promise.all(
      files.map(async ({ key: fileKey, file }) => ({
        key: fileKey,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        data: await encodeFile(file),
      })),
    );
    if (generation !== daemonIdentity.getState().generation || writes.get(storageKey) !== revision)
      return false;
    if (!writeComposerStorage(storageKey, stored.length ? stored : null)) return false;
    attachmentDrafts.setState(({ drafts }) => ({ drafts: { ...drafts, [key]: [...files] } }));
    return true;
  } catch {
    return false;
  }
}
