import { useTranslation } from "react-i18next";
import { FileJson, Minimize2, Terminal, Pencil } from "lucide-react";
import { Disclosure } from "./Disclosure";

export function TranscriptRecord({ preview, byteLength, eventKind }: {
  preview?: string; byteLength: number; eventKind?: "compaction" | "command" | "file_change";
}) {
  const { t } = useTranslation();
  const Icon = eventKind === "compaction" ? Minimize2 : eventKind === "command" ? Terminal : eventKind === "file_change" ? Pencil : FileJson;
  const messageKey = eventKind === "compaction" ? "commands.compacted" : eventKind === "command" ? "core.approvals.kind_command_execution" : eventKind === "file_change" ? "core.approvals.kind_file_change" : undefined;
  return (
    <Disclosure className="tr-record" title={<>
      <Icon size={14} aria-hidden="true" />
      <span>{messageKey ? t(messageKey) : t("core.transcript.large_record", { size: (byteLength / 1024 / 1024).toFixed(1) })}</span>
      <span className="tr-record-truncated">{t("core.transcript.truncated_preview")}</span>
    </>}>
      <pre className="tr-record-preview">{preview || t("core.transcript.preview_unavailable")}</pre>
    </Disclosure>
  );
}
