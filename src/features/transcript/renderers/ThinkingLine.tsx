import { useTranslation } from "react-i18next";
import { Disclosure } from "./Disclosure";
import { MarkdownText } from "./MarkdownText";
import "./renderers.css";

export interface ThinkingLineProps {
  text: string;
  active?: boolean;
}
export function ThinkingLine({ text, active = false }: ThinkingLineProps) {
  const { t } = useTranslation();
  const label = t(active ? "core.transcript.thinking" : "core.transcript.reasoning");
  const title = <span className={`tr-thinking-title${active ? " tr-shimmer" : ""}`} title={label}>{label}</span>;
  if (!text.trim()) return active ? <div className="tr-thinking">{title}</div> : null;
  return (
    <Disclosure className="tr-thinking" title={title}>
      <MarkdownText text={text} />
    </Disclosure>
  );
}
