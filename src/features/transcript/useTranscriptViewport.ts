import { useLayoutEffect, useRef } from "react";

// Startup and live transcripts reserve the same scrollbar gutter and text width.
export function useTranscriptViewport(active = true) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const column = viewport.parentElement!;
    const boundary = viewport.closest(".pane-body, .shell-content-scroll");
    const measureScrollbar = () => {
      const gutter = viewport.offsetWidth - viewport.clientWidth;
      const extension = boundary
        ? Math.max(
            gutter,
            boundary.getBoundingClientRect().right - column.getBoundingClientRect().right,
          )
        : gutter + 8;
      viewport.style.setProperty("--transcript-scroll-extension", `${extension}px`);
      viewport.style.setProperty("--transcript-scroll-padding", `${extension - gutter}px`);
    };
    measureScrollbar();
    const observer = new ResizeObserver(measureScrollbar);
    observer.observe(viewport);
    observer.observe(column);
    if (boundary) observer.observe(boundary);
    return () => observer.disconnect();
  }, [active]);
  return scrollRef;
}
