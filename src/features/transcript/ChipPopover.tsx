import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useOverlayFocus } from "@/app/dialogFocus";

export interface ChipPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "top" | "bottom";
  align?: "start" | "end";
  maxHeight?: number;
}

export function ChipPopover({
  anchorRef,
  onClose,
  children,
  className,
  placement = "top",
  align = "end",
  maxHeight = 400,
}: ChipPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(panelRef, true, onClose);
  useEffect(() => {
    const trigger = anchorRef.current?.querySelector<HTMLButtonElement>("button");
    // Model search can autofocus before the parent focus effect runs.
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, [anchorRef]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (panel === null || anchor === null) return;
    let transition: Animation | null = null;
    let previous: { view: string | undefined; top: number; height: number } | undefined;
    const place = () => {
      if (transition?.playState === "running") return;
      const rect = anchor.getBoundingClientRect();
      const gap = 8;
      const above = rect.top - gap * 2;
      const below = window.innerHeight - rect.bottom - gap * 2;
      const top =
        placement === "top" ? above >= Math.min(240, below) : below < Math.min(240, above);
      panel.style.maxHeight = `${Math.max(80, Math.min(maxHeight, top ? above : below))}px`;
      const left = align === "start" ? rect.left : rect.right - panel.offsetWidth;
      panel.style.left = `${Math.max(gap, Math.min(left, window.innerWidth - panel.offsetWidth - gap))}px`;
      panel.style.top = `${Math.max(gap, top ? rect.top - panel.offsetHeight - gap : rect.bottom + gap)}px`;
      panel.setAttribute(
        "aria-label",
        anchor.querySelector("button")?.getAttribute("aria-label") ?? "Options",
      );
      const view = panel.querySelector<HTMLElement>("[data-model-view]")?.dataset.modelView;
      const next = { view, top: parseFloat(panel.style.top), height: panel.offsetHeight };
      if (
        previous?.view &&
        view &&
        previous.view !== view &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        transition = panel.animate(
          [
            { top: `${previous.top}px`, height: `${previous.height}px` },
            { top: `${next.top}px`, height: `${next.height}px` },
          ],
          { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" },
        );
        transition.onfinish = () => {
          transition = null;
          place();
        };
      }
      previous = next;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      transition?.cancel();
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, placement, align, maxHeight]);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (panelRef.current?.contains(target) === true) {
        return;
      }
      if (anchorRef.current?.contains(target) === true) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [anchorRef, onClose]);
  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      aria-modal="true"
      role="dialog"
      className={`chip-popover${
        placement === "bottom" ? " chip-popover--bottom" : ""
      }${className === undefined ? "" : ` ${className}`}`}
    >
      {children}
    </div>,
    document.body,
  );
}
