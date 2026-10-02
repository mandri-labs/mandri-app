import { openCanvas } from "@/features/canvas/store";
import { fileTarget } from "@/features/canvas/targets";
import { TranscriptImage } from "./TranscriptImage";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import { SessionFileLink, isSessionFile } from "./SessionFileLink";
import remarkGfm from "remark-gfm";
import { useRef, useState, useId, useMemo, memo, isValidElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

function CodeBlock({ children, sessionId }: { children?: ReactNode; sessionId?: string }) {
  const id = useId();
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="tr-code-block">
      <button
        type="button"
        className="tr-copy"
        onClick={() => {
          void navigator.clipboard
            .writeText(ref.current?.textContent ?? "")
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {t(copied ? "core.transcript.copied" : "core.transcript.copy")}
      </button>
      {sessionId && (
        <button
          className="canvas-code-open"
          onClick={() =>
            openCanvas(sessionId, {
              kind: "excerpt",
              id,
              text: ref.current?.textContent ?? "",
              language: isValidElement<{ className?: string }>(children)
                ? (children.props.className?.replace("language-", "") ?? "")
                : "",
              title: t("core.canvas.excerpt_title"),
            })
          }
        >
          {t("core.canvas.open")}
        </button>
      )}
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
export const MarkdownText = memo(function MarkdownText({
  text,
  sessionId,
  basePath,
}: {
  text: string;
  sessionId?: string;
  basePath?: string;
}) {
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => <CodeBlock sessionId={sessionId}>{children}</CodeBlock>,
      img: ({ src, alt }) => {
        if (!src) return null;
        let source = src;
        try {
          if (isSessionFile(src)) source = fileTarget(src, basePath).path;
        } catch {
          return <span>{alt}</span>;
        }
        return <TranscriptImage sessionId={sessionId} image={{ source, name: alt || "Image" }} />;
      },
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((level) => {
          const Tag = `h${level}` as "h1";
          return [
            Tag,
            ({ children }: { children?: ReactNode }) => (
              <Tag
                id={
                  basePath
                    ? `canvas-${sessionId}-${encodeURIComponent(basePath)}-${headingText(children)
                        .toLowerCase()
                        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
                        .replace(/\s/g, "-")}`
                    : undefined
                }
              >
                {children}
              </Tag>
            ),
          ];
        }),
      ),
      a: ({ href, children }) =>
        sessionId && href && (isSessionFile(href) || (!!basePath && href.startsWith("#"))) ? (
          <SessionFileLink
            sessionId={sessionId}
            href={href}
            basePath={basePath}
            compact={!basePath && href.includes("/attachments/")}
          >
            {children}
          </SessionFileLink>
        ) : (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      table: ({ children }) => (
        <div className="tr-table-scroll">
          <table>{children}</table>
        </div>
      ),
    }),
    [sessionId, basePath],
  );
  // No rehype-raw; retain default URL sanitization.
  return (
    <div className="tr-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (isSessionFile(url) ? url : defaultUrlTransform(url))}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
});

function headingText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(headingText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return headingText(node.props.children);
  return "";
}
