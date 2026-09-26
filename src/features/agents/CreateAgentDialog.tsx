import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverlayFocus } from "@/app/dialogFocus";
import { navigate } from "@/app/useHashRoute";
import { getDaemonSocket } from "@/app/connection";
import { DaemonError, daemonErrorKey } from "@/daemon/errors";
import { refreshAgents, upsertAgent } from "@/stores/agents";
import { daemonIdentity } from "@/daemon/identity";

export function CreateAgentDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOverlayFocus(panel, true, onClose);
  const submit = async () => {
    const generation = daemonIdentity.getState().generation;
    if (busy || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const socket = getDaemonSocket();
      if (!socket)
        throw new DaemonError({ code: "service_unavailable", message: "Socket unavailable" });
      const { agent } = await socket.request("agent.create", {
        session_id: sessionId,
        content: content.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      if (generation !== daemonIdentity.getState().generation) return;
      upsertAgent(agent);
      void refreshAgents();
      onClose();
      navigate({ name: "agent", id: agent.id });
    } catch (caught) {
      if (generation !== daemonIdentity.getState().generation) return;
      if (caught instanceof DaemonError && caught.code === "delivery_unknown") {
        setContent("");
        void refreshAgents();
      }
      setError(daemonErrorKey(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lifecycle-overlay" role="presentation" onClick={onClose}>
      <form
        ref={panel}
        className="lifecycle-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("core.agents.create")}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="lifecycle-panel-title">{t("core.agents.create")}</h2>
        <label className="providers-field">
          {t("core.agents.title")}
          <input
            className="lifecycle-input"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="providers-field">
          {t("core.agents.instruction")}
          <textarea
            className="lifecycle-input"
            rows={5}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
          />
        </label>
        {error && (
          <p className="lifecycle-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="lifecycle-panel-actions">
          <button type="button" className="lifecycle-button" onClick={onClose}>
            {t("core.actions.cancel")}
          </button>
          <button
            type="submit"
            className="lifecycle-button lifecycle-button--primary"
            disabled={busy || !content.trim()}
          >
            {t("core.agents.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
