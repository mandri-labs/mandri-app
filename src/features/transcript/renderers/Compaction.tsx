import { Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TranscriptNode } from "../parse/types";
import { Disclosure } from "./Disclosure";
import { MarkdownText } from "./MarkdownText";
import "./renderers.css";

export function Compaction({ node }: { node: Extract<TranscriptNode, { kind: "compaction" }> }) {
  const { t } = useTranslation();
  const title = (
    <span
      className={`tr-thinking-title tr-compaction-title${node.status === "running" ? " tr-shimmer" : ""}`}
    >
      <Minimize2 size={14} aria-hidden="true" />
      {t(`core.transcript.compaction_${node.status}`)}
    </span>
  );
  if (!node.text && !node.error) return <div className="tr-thinking">{title}</div>;
  return (
    <Disclosure className="tr-thinking" title={title}>
      <MarkdownText text={node.error ?? node.text} />
    </Disclosure>
  );
}
