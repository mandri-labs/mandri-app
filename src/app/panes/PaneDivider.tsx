import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { panesStore } from "@/stores/panes";

export function PaneDivider({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  const { t } = useTranslation();
  const horizontal = orientation === "horizontal";
  const ratio = useStore(panesStore, (state) => (horizontal ? state.rowRatio : state.splitRatio));
  const setRatio = (value: number) => {
    const state = panesStore.getState();
    if (horizontal) state.setRowRatio(value);
    else state.setSplitRatio(value);
  };
  return (
    <div
      role="separator"
      className={`pane-divider pane-divider--${orientation}`}
      tabIndex={0}
      aria-label={t(horizontal ? "core.panes.resize_rows" : "core.panes.resize")}
      aria-orientation={orientation}
      aria-valuemin={30}
      aria-valuemax={70}
      aria-valuenow={ratio}
      style={
        horizontal
          ? undefined
          : { left: `calc((100% - var(--pane-gap)) * ${ratio / 100} + var(--pane-gap) / 2)` }
      }
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const parent = event.currentTarget.parentElement!;
        const bounds = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        const gap = parseFloat(horizontal ? style.rowGap : style.columnGap);
        const length = horizontal
          ? Math.max(
              parent.clientHeight,
              parseFloat(style.getPropertyValue("--pane-grid-min-height")),
            )
          : parent.clientWidth;
        const offset = horizontal
          ? event.clientY - bounds.top + parent.scrollTop
          : event.clientX - bounds.left;
        setRatio(((offset - gap / 2) / (length - gap)) * 100);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onDoubleClick={() => setRatio(50)}
      onKeyDown={(event) => {
        const next =
          event.key === (horizontal ? "ArrowUp" : "ArrowLeft")
            ? ratio - 5
            : event.key === (horizontal ? "ArrowDown" : "ArrowRight")
              ? ratio + 5
              : event.key === "Home"
                ? 30
                : event.key === "End"
                  ? 70
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        setRatio(next);
      }}
    />
  );
}
