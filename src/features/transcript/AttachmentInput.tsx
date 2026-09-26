import { daemonIdentity } from "@/daemon/identity";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Plus, X, File as FileIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { isTauri } from "@/lib/platform";
import { readClipboardImage } from "@/lib/platform/clipboard";
import {
  attachmentDrafts,
  filesFor,
  restoreFiles,
  setFiles,
  setAttachmentError,
  type DraftAttachment,
} from "./attachments";
import "./attachments.css";

export function useAttachmentInput(key: string, disabled: boolean) {
  const { t } = useTranslation();
  const pasteVersion = useRef(0);
  const endpoint = useStore(daemonIdentity, (state) => state.baseUrl);
  useEffect(() => restoreFiles(key), [key, endpoint]);
  useEffect(
    () => () => {
      pasteVersion.current += 1;
    },
    [key, disabled],
  );
  const files = useStore(attachmentDrafts, (state) => state.drafts[key]);
  const error = useStore(attachmentDrafts, (state) => state.errors[key] ?? null);
  const setError = (value: string | null) => setAttachmentError(key, value);
  const add = (incoming: File[]) => {
    if (disabled) return;
    const current = filesFor(key);
    if (current.length + incoming.length > 4) {
      setError(t("core.attachments.count_limit"));
      return;
    }
    if (incoming.some((file) => file.size === 0 || file.size > 20 * 1024 * 1024)) {
      setError(t("core.attachments.size_limit"));
      return;
    }
    if (
      incoming.some(
        (file) =>
          file.type.startsWith("image/") &&
          (file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)),
      )
    ) {
      setError(t("core.attachments.image_limit"));
      return;
    }
    setFiles(key, [...current, ...incoming.map((file) => ({ key: crypto.randomUUID(), file }))]);
    setError(null);
  };
  const nativePaste = () => {
    if (!isTauri() || disabled) return;
    const version = ++pasteVersion.current;
    setTimeout(() => {
      if (pasteVersion.current !== version) return;
      void readClipboardImage()
        .then((file) => {
          if (pasteVersion.current === version && file) add([file]);
        })
        .catch(() => {
          if (pasteVersion.current === version) setError(t("core.attachments.paste_failed"));
        });
    }, 0);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const pasted = items.length ? items : Array.from(event.clipboardData.files ?? []);
    if (!pasted.length) {
      nativePaste();
      return;
    }
    pasteVersion.current += 1;
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    add(pasted);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "v" &&
      !event.repeat
    ) {
      nativePaste();
    }
  };
  return {
    files: files ?? [],
    add,
    onPaste,
    onKeyDown,
    error,
    setError,
    remove: (id: string) =>
      setFiles(
        key,
        filesFor(key).filter((item) => item.key !== id),
      ),
  };
}

function AttachmentChip({
  item,
  remove,
  disabled,
}: {
  item: DraftAttachment;
  remove: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!["image/png", "image/jpeg"].includes(item.file.type)) return;
    const url = URL.createObjectURL(item.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file]);
  return (
    <div className="attachment-chip">
      {preview ? <img src={preview} alt="" /> : <FileIcon size={18} />}
      <span title={item.file.name}>{item.file.name}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={t("core.attachments.remove", { name: item.file.name })}
        onClick={remove}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function AttachmentChips({
  input,
  disabled,
}: {
  input: ReturnType<typeof useAttachmentInput>;
  disabled: boolean;
}) {
  return (
    <>
      {!disabled && input.files.length > 0 && (
        <div className="attachment-chips">
          {input.files.map((item) => (
            <AttachmentChip
              key={item.key}
              item={item}
              disabled={disabled}
              remove={() => input.remove(item.key)}
            />
          ))}
        </div>
      )}
      {input.error && (
        <div className="composer-error" role="alert">
          {input.error}
        </div>
      )}
    </>
  );
}

export function AttachmentButton({
  input,
  disabled,
}: {
  input: ReturnType<typeof useAttachmentInput>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          input.add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className="composer-chip attachment-add"
        disabled={disabled}
        title={t("core.attachments.add")}
        aria-label={t("core.attachments.add")}
        onClick={() => picker.current?.click()}
      >
        <Plus size={18} />
      </button>
    </>
  );
}
