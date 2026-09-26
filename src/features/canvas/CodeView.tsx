import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import hljs from "highlight.js/lib/common";
export function CodeView({
  text,
  language,
  line,
  endLine,
  column,
  revision,
}: {
  text: string;
  language?: string;
  line?: number;
  endLine?: number;
  column?: number;
  revision?: number;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState(false);
  const highlighted = useMemo(() => {
    const name = language && hljs.getLanguage(language) ? language : "plaintext";
    return text
      .split("\n")
      .map((value) =>
        value.length > 10_000
          ? null
          : hljs.highlight(value, { language: name, ignoreIllegals: true }).value,
      );
  }, [text, language]);
  const lines = text.split("\n");
  const unavailable =
    line !== undefined &&
    (line < 1 ||
      line > lines.length ||
      (endLine !== undefined && (endLine < line || endLine > lines.length)) ||
      (column !== undefined && (column < 1 || column > (lines[line - 1]?.length ?? 0) + 1)));
  useEffect(() => {
    if (line && !unavailable)
      ref.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView?.({ block: "center" });
  }, [line, endLine, column, revision, unavailable, text]);
  return (
    <>
      <div className="canvas-reader-tools">
        <button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
          {t("core.canvas.wrap")}
        </button>
      </div>
      {unavailable && (
        <p role="status" className="canvas-notice">
          {t("core.canvas.line_unavailable")}
        </p>
      )}
      <div ref={ref} className={`canvas-code ${wrap ? "canvas-code-wrap" : ""}`}>
        <pre>
          {lines.map((value, index) => (
            <div
              key={index}
              data-line={index + 1}
              className={
                line && index + 1 >= line && index + 1 <= (endLine ?? line)
                  ? "canvas-selected-line"
                  : undefined
              }
            >
              <span className="canvas-line-number" aria-hidden="true">
                {index + 1}
              </span>
              {highlighted[index] === null ? (
                <code>{value || " "}</code>
              ) : (
                <code dangerouslySetInnerHTML={{ __html: highlighted[index] || " " }} />
              )}
            </div>
          ))}
        </pre>
      </div>
    </>
  );
}
