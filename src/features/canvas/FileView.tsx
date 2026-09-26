import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readSessionFile, downloadBlob, imageMime } from "./resources";
import { CodeView } from "./CodeView";
import { ImageView } from "./ImageView";
import { MarkdownText } from "@/features/transcript/renderers/MarkdownText";
import type { CanvasTab } from "./store";

export function FileView({ sessionId, tab }: { sessionId: string; tab: CanvasTab }) {
  const { t } = useTranslation();
  const target = tab.target;
  const path = target.kind === "file" ? target.path : undefined;
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState(target.kind === "file" && !!target.line);
  const selectedLine = target.kind === "file" ? target.line : undefined;
  useEffect(() => {
    if (selectedLine) setSource(true);
  }, [selectedLine, tab.revision]);
  const [result, setResult] = useState<{
    path: string;
    blob?: Blob;
    text?: string;
    image?: boolean;
    error?: boolean;
  }>();
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let active = true;
    void readSessionFile(sessionId, path, controller.signal)
      .then(async (blob) => {
        const image = !!(await imageMime(blob));
        let text: string | undefined;
        if (!image && blob.size <= 2_000_000) {
          try {
            const candidate = new TextDecoder("utf-8", { fatal: true }).decode(
              await blob.arrayBuffer(),
            );
            if (
              !candidate.includes("\0") &&
              !candidate.startsWith("%PDF-") &&
              candidate.split("\n").length <= 20_000
            )
              text = candidate;
          } catch {
            /* Binary files remain downloadable. */
          }
        }
        if (active) setResult({ path, blob, text, image });
      })
      .catch(() => {
        if (active) setResult({ path, error: true });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionId, path, attempt]);
  useEffect(() => {
    if (target.kind !== "file" || !target.anchor || source) return;
    const timer = requestAnimationFrame(() =>
      document
        .getElementById(`canvas-${sessionId}-${encodeURIComponent(target.path)}-${target.anchor}`)
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(timer);
  }, [target, tab.revision, source, result, sessionId]);
  if (target.kind === "image") return <ImageView target={target} sessionId={sessionId} />;
  if (target.kind === "excerpt")
    return (
      <>
        <p className="canvas-notice">{t("core.canvas.excerpt")}</p>
        <CodeView text={target.text} language={target.language} />
      </>
    );
  const current = result?.path === path ? result : undefined;
  if (!current || current.error)
    return (
      <div className="canvas-state" role="status">
        {t(current?.error ? "core.canvas.unavailable" : "core.canvas.loading")}
        {current?.error && (
          <button
            onClick={() => {
              setResult(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            {t("core.canvas.retry")}
          </button>
        )}
      </div>
    );
  if (current.image)
    return (
      <ImageView
        target={{ kind: "image", source: target.path, path: target.path, title: target.title }}
        sessionId={sessionId}
      />
    );
  const markdown = /\.(md|markdown|mdown)$/i.test(target.path);
  const extension = target.path.split(".").pop()?.toLowerCase();
  const language =
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        rs: "rust",
        sh: "bash",
        md: "markdown",
      } as Record<string, string>
    )[extension ?? ""] ?? extension;
  return (
    <>
      <div className="canvas-reader-tools">
        {markdown && (
          <button aria-pressed={source} onClick={() => setSource(!source)}>
            {t(source ? "core.canvas.preview" : "core.canvas.source")}
          </button>
        )}
        {current.text !== undefined && (
          <button onClick={() => void navigator.clipboard.writeText(current.text!).catch(() => {})}>
            {t("core.transcript.copy")}
          </button>
        )}
        <button onClick={() => downloadBlob(current.blob!, target.title)}>
          {t("core.canvas.download")}
        </button>
        <button
          onClick={() => {
            setResult(undefined);
            setAttempt((value) => value + 1);
          }}
        >
          {t("core.canvas.reload")}
        </button>
      </div>
      {current.text === undefined ? (
        <div className="canvas-state">{t("core.canvas.unsupported")}</div>
      ) : markdown && !source ? (
        <div className="canvas-document">
          <MarkdownText text={current.text} sessionId={sessionId} basePath={target.path} />
        </div>
      ) : (
        <CodeView
          text={current.text}
          language={language}
          line={target.line}
          column={target.column}
          endLine={target.endLine}
          revision={tab.revision}
        />
      )}
    </>
  );
}
