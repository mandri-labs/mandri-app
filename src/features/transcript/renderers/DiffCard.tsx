import "./renderers.css";
import { Pencil } from "lucide-react";
import { FilePath } from "./FilePath";
import { Disclosure } from "./Disclosure";
import { useTranslation } from "react-i18next";

export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffCardProps {
  path: string;
  additions?: number;
  deletions?: number;
  unavailable?: boolean;
  lines?: DiffLine[];
}

export function DiffCard({ path, additions, deletions, lines, unavailable }: DiffCardProps) {
  const { t } = useTranslation();
  const hasLines = lines !== undefined && lines.length > 0;
  return (
    <Disclosure
      className="tr-diff"
      title={
        <>
          <Pencil size={14} aria-hidden="true" />
          <FilePath path={path} />
          {additions !== undefined && <span className="tr-diff-add">+{additions}</span>}
          {deletions !== undefined && <span className="tr-diff-del">&minus;{deletions}</span>}
        </>
      }
    >
      {hasLines && (
        <div className="tr-diff-body">
          {lines.map((line, index) => (
            <div key={index} className={`tr-diff-row tr-diff-row-${line.type}`}>
              <span className="tr-diff-no">{line.oldNo ?? ""}</span>
              <span className="tr-diff-no">{line.newNo ?? ""}</span>
              <span className="tr-diff-code">{line.text}</span>
            </div>
          ))}
        </div>
      )}
      {!hasLines && <p className="tr-tool-detail">{t(unavailable ? "core.transcript.diff_unavailable" : "core.transcript.no_diff")}</p>}
    </Disclosure>
  );
}
