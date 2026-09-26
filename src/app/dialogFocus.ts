import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const overlays: symbol[] = [];

export function useOverlayFocus(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose?: () => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = Symbol("overlay");
    overlays.push(token);
    const panel = panelRef.current;
    const focusables =
      panel === null ? [] : Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const firstFocusable = focusables[0];
    if (firstFocusable !== undefined) {
      firstFocusable.focus();
    } else {
      panel?.focus();
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (overlays.at(-1) !== token || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || panel === null) {
        return;
      }
      const current = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = current[0];
      const last = current[current.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const topmost = overlays.at(-1) === token;
      overlays.splice(overlays.indexOf(token), 1);
      if (topmost && previous?.isConnected) {
        previous.focus();
      }
    };
  }, [open, panelRef]);
}
