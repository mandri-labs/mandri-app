import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image as ImageIcon, ZoomIn, ZoomOut, Maximize, Download, RotateCw } from "lucide-react";
import { useStore } from "@/app/useStore";
import { daemonIdentity } from "@/daemon/identity";
import { readSessionFile, imageMime, downloadBlob } from "./resources";
import { openCanvas } from "./store";
import type { ImageTarget } from "./targets";

export function ImageView({
  target,
  sessionId,
  compact = false,
}: {
  target: ImageTarget;
  sessionId?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const identity = `${generation}:${sessionId}:${target.source}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    identity: string;
    url?: string;
    blob?: Blob;
    error?: boolean;
  }>();
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    let active = true,
      url: string | undefined;
    const controller = new AbortController();
    const load = async () => {
      const source = target.source;
      if (/^https?:\/\//i.test(source)) {
        const remote = new URL(source);
        if (remote.username || remote.password) throw new Error("Invalid image URL");
        return { url: source };
      }
      let blob: Blob;
      if (target.file) {
        blob = target.file;
      } else if (
        /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(source) &&
        source.length <= 28_000_000
      ) {
        const binary = atob(source.slice(source.indexOf(",") + 1));
        blob = new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))]);
      } else {
        if (!sessionId || (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)))
          throw new Error("Image unavailable");
        blob = await readSessionFile(sessionId, source, controller.signal);
      }
      const mime = await imageMime(blob);
      if (!mime) throw new Error("Unsupported image");
      if (!active) return;
      blob = new Blob([blob], { type: mime });
      url = URL.createObjectURL(blob);
      return { url, blob };
    };
    void load()
      .then((value) => {
        if (active && value) setResult({ identity, ...value });
      })
      .catch(() => {
        if (active) setResult({ identity, error: true });
      });
    return () => {
      active = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [identity, sessionId, target.source, target.file, attempt]);
  const current = result?.identity === identity ? result : undefined;
  const image =
    current?.url && !current.error ? (
      <img
        draggable={false}
        onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
        src={current.url}
        alt={target.title}
        referrerPolicy="no-referrer"
        style={
          !compact && zoom !== null
            ? { width: `${(naturalWidth * zoom) / 100}px`, maxWidth: "none", maxHeight: "none" }
            : undefined
        }
        onError={() => setResult({ identity, error: true })}
      />
    ) : null;
  if (compact)
    return (
      <button
        type="button"
        className="canvas-attachment"
        aria-label={`${target.title}${current?.error ? ` ${t("core.attachments.image_unavailable")}` : ""}`}
        title={target.title}
        disabled={!sessionId}
        onClick={() => sessionId && openCanvas(sessionId, target)}
      >
        {image ?? <ImageIcon size={24} />}
        <span>
          {target.title}
          {current?.error && <small>{t("core.attachments.image_unavailable")}</small>}
        </span>
      </button>
    );
  return (
    <div className="canvas-image-view">
      <div className="canvas-reader-tools">
        <button
          title={t("core.canvas.fit")}
          aria-label={t("core.canvas.fit")}
          onClick={() => setZoom(null)}
        >
          <Maximize size={16} />
        </button>
        <button
          title={t("core.canvas.zoom_out")}
          aria-label={t("core.canvas.zoom_out")}
          onClick={() => setZoom(Math.max(25, (zoom ?? 100) - 25))}
        >
          <ZoomOut size={16} />
        </button>
        <button onClick={() => setZoom(100)}>
          {zoom === null ? t("core.canvas.fit") : `${zoom}%`}
        </button>
        <button
          title={t("core.canvas.zoom_in")}
          aria-label={t("core.canvas.zoom_in")}
          onClick={() => setZoom(Math.min(400, (zoom ?? 100) + 25))}
        >
          <ZoomIn size={16} />
        </button>
        {current?.blob && (
          <button
            title={t("core.canvas.download")}
            aria-label={t("core.canvas.download")}
            onClick={() => downloadBlob(current.blob!, target.title)}
          >
            <Download size={16} />
          </button>
        )}
      </div>
      <div
        className="canvas-image-stage"
        onPointerDown={(event) => {
          if (event.button !== 0 || !image) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pan.current = {
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          };
        }}
        onPointerMove={(event) => {
          if (!pan.current) return;
          event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
          event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
        }}
        onPointerUp={() => {
          pan.current = null;
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
      >
        {image ?? (
          <div className="canvas-state" role="status">
            {t(
              current?.error
                ? "core.attachments.image_unavailable"
                : "core.attachments.image_loading",
            )}
            {current?.error && (
              <button
                onClick={() => {
                  setResult(undefined);
                  setAttempt((value) => value + 1);
                }}
              >
                <RotateCw size={16} />
                {t("core.canvas.retry")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
