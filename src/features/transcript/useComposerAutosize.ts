import { useLayoutEffect, useRef } from "react";

const MEASUREMENT_STYLES = [
  "box-sizing", "font-family", "font-size", "font-style", "font-weight",
  "font-variation-settings", "line-height", "letter-spacing", "word-spacing",
  "text-indent", "text-transform", "tab-size", "white-space", "word-break",
  "overflow-wrap", "padding-top", "padding-bottom", "padding-left", "padding-right",
  "border-top-width", "border-bottom-width", "border-left-width", "border-right-width",
  "border-style",
] as const;

export function useComposerAutosize() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const attached = useRef<{
    input: HTMLTextAreaElement;
    value: string;
    resize: () => void;
    dispose: () => void;
  } | null>(null);

  // Inspect commits for programmatic drafts and conditional mounts, but keep the
  // observer and measurement field alive until the actual textarea is replaced.
  useLayoutEffect(() => {
    const input = ref.current;
    if (attached.current?.input !== input) {
      attached.current?.dispose();
      attached.current = null;
    }
    // Native sizing avoids synchronous layout reads altogether on newer engines.
    if (!input || CSS.supports("field-sizing", "content")) return;
    if (attached.current) {
      if (attached.current.value !== input.value) attached.current.resize();
      return;
    }

    // Older WebKit versions measure an isolated field, never collapse the live
    // composer (which also resizes every transcript sharing its flex/grid layout).
    const mirror = document.createElement("textarea");
    mirror.setAttribute("aria-hidden", "true");
    mirror.tabIndex = -1;
    mirror.wrap = input.wrap;
    mirror.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:strict;height:0;min-height:0;max-height:none;overflow:hidden;";
    document.body.append(mirror);
    let borderHeight = 0;
    const measureStyle = () => {
      const style = getComputedStyle(input);
      for (const property of MEASUREMENT_STYLES) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      const borderWidth = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      borderHeight = style.boxSizing === "border-box"
        ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : -(parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
      mirror.style.width = `${input.clientWidth + (style.boxSizing === "border-box" ? borderWidth : -(parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)))}px`;
    };

    const resize = (remeasure = false) => {
      const previous = attached.current?.value;
      // Normal typing can only grow the existing field. Reuse its incremental
      // text layout; reserve the mirror for deletions, replaced drafts and widths.
      const appended = !remeasure && previous !== undefined && input.value.length > previous.length && input.value.startsWith(previous);
      if (!appended) mirror.value = input.value || input.placeholder;
      const height = `${(appended ? input.scrollHeight : mirror.scrollHeight) + borderHeight}px`;
      if (input.style.height !== height) input.style.height = height;
      if (attached.current) attached.current.value = input.value;
    };
    const remeasure = () => { measureStyle(); resize(true); };
    let width: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width;
      if (nextWidth !== width) {
        width = nextWidth;
        remeasure();
      }
    });
    observer.observe(input);
    window.addEventListener("resize", remeasure);
    document.fonts?.addEventListener("loadingdone", remeasure);
    attached.current = {
      input, value: input.value, resize,
      dispose: () => {
        observer.disconnect();
        window.removeEventListener("resize", remeasure);
        document.fonts?.removeEventListener("loadingdone", remeasure);
        mirror.remove();
      },
    };
    remeasure();
  });

  useLayoutEffect(() => () => {
    attached.current?.dispose();
    attached.current = null;
  }, []);

  return ref;
}
