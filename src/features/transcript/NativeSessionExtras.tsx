import { useStore } from "@/app/useStore";
import { nativeSessionUiStore } from "@/stores/nativeSessionUi";
import "./native-session-extras.css";

function terminalText(text: string): string {
  // Native extensions often style their text with terminal CSI/OSC sequences.
  // Preserve the words in the application's own typography.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g, "");
}

export function NativeSessionExtras({
  sessionId,
  placement,
}: {
  sessionId: string;
  placement: "aboveEditor" | "belowEditor";
}) {
  const ui = useStore(nativeSessionUiStore, (state) => state.sessions[sessionId]);
  if (!ui) return null;
  const widgets = Object.entries(ui.widgets).filter(([, widget]) => widget.placement === placement);
  const statuses = placement === "belowEditor" ? Object.entries(ui.statuses) : [];
  if (!widgets.length && !statuses.length) return null;
  return (
    <div className="native-session-extras" role="status" aria-live="polite">
      {widgets.map(([key, widget]) => (
        <pre key={key}>{terminalText(widget.lines.join("\n"))}</pre>
      ))}
      {statuses.map(([key, text]) => (
        <span key={key}>{terminalText(text)}</span>
      ))}
    </div>
  );
}
