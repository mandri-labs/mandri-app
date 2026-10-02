import { PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { canvasStore, emptyCanvas, updateCanvas } from "./store";

export function CanvasReopenButton({
  sessionId,
  className = "canvas-reopen",
}: {
  sessionId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const state = useStore(canvasStore, (value) => value.sessions[sessionId] ?? emptyCanvas);
  if (state.open || !state.tabs.length) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label={t("core.canvas.open")}
      title={t("core.canvas.open")}
      onClick={() => updateCanvas(sessionId, (current) => ({ ...current, open: true }))}
    >
      <PanelRightOpen size={14} aria-hidden="true" />
    </button>
  );
}
