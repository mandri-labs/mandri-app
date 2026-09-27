import { useLayoutEffect, useRef } from "react";

export function useComposerAutosize() {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Run after every commit to also handle drafts and conditionally mounted inputs.
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;

    const resize = () => {
      input.style.overflowY = "hidden";
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
      input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
    };
    resize();

    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = input.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(input);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  });

  return ref;
}
