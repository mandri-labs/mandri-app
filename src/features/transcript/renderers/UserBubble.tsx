import { useMemo } from "react";
import { userImages, type TranscriptImage as ImageReference } from "../parse/images";
import { TranscriptImage } from "./TranscriptImage";
import { MarkdownText } from "./MarkdownText";
import "./renderers.css";
import { useTranslation } from "react-i18next";
import { Disclosure } from "./Disclosure";

export interface UserBubbleProps {
  text: string;
  sessionId?: string;
  images?: ImageReference[];
}

export function UserBubble({ text: original, sessionId, images }: UserBubbleProps) {
  const parsed = useMemo(() => userImages(original, images), [original, images]);
  const text = parsed.text;
  const { t } = useTranslation();
  const rendered =
    sessionId && /\[[^\]]+\]\([^)]+\)/.test(text) ? (
      <MarkdownText text={text} sessionId={sessionId} />
    ) : (
      text
    );
  const long = text.length > 650 || text.split("\n").length > 8;
  return (
    <div className="tr-user-row">
      <div className="tr-user-bubble">
        {long ? (
          <Disclosure
            title={
              <span className="tr-user-preview">
                {text.slice(0, 220)}… <span>{t("core.transcript.read_message")}</span>
              </span>
            }
          >
            <div className="tr-user-full">{rendered}</div>
          </Disclosure>
        ) : (
          rendered
        )}
        {parsed.images.length > 0 && (
          <div className="tr-images">
            {parsed.images.map((image, index) => (
              <TranscriptImage
                key={`${index}:${image.source.slice(0, 160)}`}
                image={image}
                sessionId={sessionId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
