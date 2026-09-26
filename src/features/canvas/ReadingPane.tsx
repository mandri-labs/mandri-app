import { useLayoutEffect, useRef, type ReactNode } from "react";
import { daemonIdentity } from "@/daemon/identity";
const positions = new Map<string, Map<string, [number, number]>>();
daemonIdentity.subscribe(() => positions.clear());
export function ReadingPane({
  id,
  active,
  title,
  children,
}: {
  id: string;
  active: boolean;
  title: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!active || !root.current) return;
    const restore = () =>
      positions.get(id)?.forEach(([top, left], selector) => {
        const element = root.current?.querySelector(selector);
        if (element) {
          element.scrollTop = top;
          element.scrollLeft = left;
        }
      });
    restore();
    const observer = new MutationObserver(restore);
    observer.observe(root.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [id, active]);
  return (
    <div
      ref={root}
      role="tabpanel"
      aria-label={title}
      hidden={!active}
      className="canvas-tab-content"
      onScrollCapture={(event) => {
        const element = event.target as HTMLElement;
        const name = ["canvas-code", "canvas-document", "canvas-image-stage"].find((value) =>
          element.classList.contains(value),
        );
        if (!name) return;
        const saved = positions.get(id) ?? new Map();
        saved.set(`.${name}`, [element.scrollTop, element.scrollLeft]);
        positions.set(id, saved);
      }}
    >
      {children}
    </div>
  );
}
