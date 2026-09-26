import "./renderers.css";
import { MarkdownText } from "./MarkdownText";

export interface AssistantTextProps {
  text: string;
  sessionId?: string;
  streaming?: boolean;
}

export function AssistantText({ text, sessionId, streaming = false }: AssistantTextProps) {
  return (
    <div className="tr-assistant">
      <MarkdownText text={text} sessionId={sessionId} />
      {streaming && <span className="tr-caret" aria-hidden="true" />}
    </div>
  );
}
