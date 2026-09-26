import { useLayoutEffect, useRef, useState } from "react";

// Keep all segments whenever they fit. When needed, remove only leading
// directories, preserving the filename and as much of its parent path as possible.
export function fitFilePath(path: string, fits: (text: string) => boolean): string {
  if (fits(path)) return path;
  const separators = [...path.matchAll(/[/\\]/g)].map((match) => match.index!);
  for (const index of separators) {
    const candidate = `…${path.slice(index)}`;
    if (fits(candidate)) return candidate;
  }
  return separators.length ? `…${path.slice(separators.at(-1))}` : path;
}

export function FilePath({ path }: { path: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState(path);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const measure = () => {
      const style = getComputedStyle(element);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      setLabel(fitFilePath(path, (text) => context.measureText(text).width <= element.clientWidth));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [path]);
  return <span ref={ref} className="tr-file-path" title={path} aria-label={path}>{label}</span>;
}
