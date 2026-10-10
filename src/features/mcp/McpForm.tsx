import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Cable, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOverlayFocus } from "@/app/dialogFocus";
import { daemonIdentity } from "@/daemon/identity";
import {
  createMcpServer,
  updateMcpServer,
  type McpServer,
  type McpChanges,
} from "@/daemon/rest/mcp";
import { Arguments } from "./Arguments";
import { SecretFields, secretChanges, secretEntries, type SecretEntry } from "./SecretFields";

export function McpForm({
  server,
  onSaved,
  onClose,
}: {
  server?: McpServer;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  useOverlayFocus(panel, true, onClose);
  const [transport, setTransport] = useState<McpServer["transport"]>(server?.transport ?? "stdio");
  const [args, setArgs] = useState<string[]>(server?.args ?? []);
  const [env, setEnv] = useState(() => secretEntries(server?.env_keys ?? []));
  const [headers, setHeaders] = useState(() => secretEntries(server?.header_keys ?? []));
  const [refs, setRefs] = useState<SecretEntry[]>(() =>
    Object.entries(server?.env_refs ?? {}).map(([name, value]) => ({
      id: crypto.randomUUID(),
      name,
      value,
      stored: false,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(daemonIdentity.getState().generation);
  const local = transport === "stdio";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "");
    try {
      const changes: McpChanges = {
        name: text("name").trim(),
        transport,
        command: local ? text("command").trim() : null,
        args: local ? args : [],
        cwd: local ? text("cwd").trim() || null : null,
        url: local ? null : text("url").trim(),
        env_refs: local
          ? Object.fromEntries(
              Object.entries(secretChanges(refs, [])).filter(
                (row): row is [string, string] => row[1] !== null,
              ),
            )
          : {},
        auth: !local && data.get("oauth") ? "oauth" : "none",
        allow_protected: Boolean(data.get("protected")),
        startup_timeout: Number(text("startupTimeout")) || 15,
        call_timeout: Number(text("callTimeout")) || 60,
      };
      const environment = local ? secretChanges(env, server?.env_keys ?? []) : {};
      const headerValues = !local ? secretChanges(headers, server?.header_keys ?? []) : {};
      if (server) {
        changes.env_updates = environment;
        changes.header_updates = headerValues;
        if (!local) changes.env = {};
        if (local) changes.headers = {};
        await updateMcpServer(server, changes);
      } else {
        await createMcpServer({
          ...changes,
          name: changes.name!,
          env: Object.fromEntries(
            Object.entries(environment).filter((row): row is [string, string] => row[1] !== null),
          ),
          headers: Object.fromEntries(
            Object.entries(headerValues).filter((row): row is [string, string] => row[1] !== null),
          ),
        });
      }
      if (generation.current === daemonIdentity.getState().generation) onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("core.mcp.unavailable"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="providers-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panel}
        className="providers-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(server ? "core.mcp.edit" : "core.mcp.add")}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="providers-dialog-title">{t(server ? "core.mcp.edit" : "core.mcp.add")}</h2>
        <form className="providers-form" onSubmit={(event) => void submit(event)}>
          <label className="providers-field">
            <span className="providers-field-label">{t("core.mcp.name")}</span>
            <input
              name="name"
              className="providers-input"
              required
              defaultValue={server?.name ?? ""}
              pattern="[A-Za-z][A-Za-z0-9_-]{0,47}"
              autoComplete="off"
            />
          </label>
          <div className="mcp-transport-picker">
            <button
              type="button"
              className="providers-button"
              aria-pressed={local}
              onClick={() => setTransport("stdio")}
            >
              <Cable size={16} aria-hidden="true" />
              {t("core.mcp.local")}
            </button>
            <button
              type="button"
              className="providers-button"
              aria-pressed={!local}
              onClick={() => setTransport(server?.transport === "sse" ? "sse" : "streamable_http")}
            >
              <Globe size={16} aria-hidden="true" />
              {t("core.mcp.remote")}
            </button>
          </div>
          {local ? (
            <>
              <label className="providers-field">
                <span className="providers-field-label">{t("core.mcp.command")}</span>
                <input
                  name="command"
                  className="providers-input"
                  required
                  defaultValue={server?.command ?? ""}
                  placeholder="npx"
                  autoComplete="off"
                />
              </label>
              <Arguments args={args} onChange={setArgs} />
            </>
          ) : (
            <>
              <label className="providers-field">
                <span className="providers-field-label">URL</span>
                <input
                  name="url"
                  type="url"
                  className="providers-input"
                  required
                  defaultValue={server?.url ?? ""}
                  placeholder="https://"
                />
              </label>
              <label className="mcp-option">
                <input type="checkbox" name="oauth" defaultChecked={server?.auth === "oauth"} />
                OAuth
              </label>
            </>
          )}
          <details className="mcp-advanced">
            <summary>{t("core.mcp.advanced")}</summary>
            {local ? (
              <>
                <label className="providers-field">
                  <span className="providers-field-label">{t("core.mcp.directory")}</span>
                  <input name="cwd" className="providers-input" defaultValue={server?.cwd ?? ""} />
                </label>
                <SecretFields label={t("core.mcp.environment")} entries={env} onChange={setEnv} />
                <SecretFields
                  label={t("core.mcp.environment_refs")}
                  entries={refs}
                  onChange={setRefs}
                  secret={false}
                />
              </>
            ) : (
              <>
                <SecretFields
                  label={t("core.mcp.headers")}
                  entries={headers}
                  onChange={setHeaders}
                />
                <label className="mcp-option">
                  <input
                    type="checkbox"
                    checked={transport === "sse"}
                    onChange={(event) =>
                      setTransport(event.target.checked ? "sse" : "streamable_http")
                    }
                  />
                  SSE
                </label>
              </>
            )}
            <label className="mcp-option">
              <input
                type="checkbox"
                name="protected"
                defaultChecked={server?.allow_protected ?? false}
              />
              {t("core.mcp.protected")}
            </label>
            <label className="providers-field">
              <span className="providers-field-label">{t("core.mcp.startup_timeout")}</span>
              <input
                name="startupTimeout"
                className="providers-input"
                type="number"
                min="1"
                max="120"
                defaultValue={server?.startup_timeout ?? 15}
              />
            </label>
            <label className="providers-field">
              <span className="providers-field-label">{t("core.mcp.call_timeout")}</span>
              <input
                name="callTimeout"
                className="providers-input"
                type="number"
                min="1"
                max="3600"
                defaultValue={server?.call_timeout ?? 60}
              />
            </label>
          </details>
          {error && (
            <div className="providers-form-error" role="alert">
              {error}
            </div>
          )}
          <div className="providers-dialog-actions">
            <button type="button" className="providers-button" onClick={onClose}>
              {t("core.actions.cancel")}
            </button>
            <button
              type="submit"
              className="providers-button providers-button--primary"
              disabled={saving}
            >
              {t("core.mcp.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
