import { activityKind, activityToolTitle } from "../activitySummary";
import { activityIcons } from "./activityIcons";
import { useMemo } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TranscriptNode } from "../parse/types";
import { codexResultSections, codexToolTitle } from "../parse/codexToolView";
import { useStore } from "@/app/useStore";
import { debugPreferencesStore } from "@/stores/debugPreferences";
import { Disclosure } from "./Disclosure";
import { CodexInteraction } from "./CodexInteraction";
import { CodexAgentActivity, isCodexAgentActivity } from "./CodexAgentActivity";
import "./renderers.css";

type ToolNode = Extract<TranscriptNode, { kind: "tool" }>;

function Fields({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth > 10) return <pre className="tr-tool-detail">{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value))
    return (
      <ul className="tr-codex-list">
        {value.map((entry, index) => (
          <li key={index}>
            <Fields value={entry} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  if (value !== null && typeof value === "object")
    return (
      <dl className="tr-codex-fields">
        {Object.entries(value).map(([key, entry]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>
              <Fields value={entry} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span className="tr-codex-value">{String(value ?? "")}</span>;
}

function Details({ node }: { node: ToolNode }) {
  const { t } = useTranslation();
  const debug = useStore(debugPreferencesStore, (state) => state.showTechnicalEvents);
  const sections = useMemo(() => codexResultSections(node.codex?.output), [node.codex?.output]);
  const input = node.codex?.input;
  return (
    <div className="tr-codex-details">
      <CodexInteraction tool={node.tool} input={input} output={node.codex?.output} />
      {input !== undefined && (
        <details className="tr-codex-input">
          <summary>{t("core.transcript.tool_input")}</summary>
          {typeof input === "string" ? (
            <pre className="tr-tool-detail">{input}</pre>
          ) : (
            <Fields value={input} />
          )}
        </details>
      )}
      {sections.map((section, index) => (
        <section className="tr-codex-result" key={index}>
          {(sections.length > 1 ||
            section.exitCode !== undefined ||
            (section.durationMs !== undefined && section.durationMs >= 1000)) && (
            <div className="tr-tool-detail-head">
              {sections.length > 1 && (
                <span>{t("core.transcript.tool_result", { number: index + 1 })}</span>
              )}
              {section.exitCode !== undefined && (
                <span>{t("core.transcript.exit_code", { code: section.exitCode })}</span>
              )}
              {section.durationMs !== undefined && section.durationMs >= 1000 && (
                <span>
                  {(section.durationMs / 1000).toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{" "}
                  s
                </span>
              )}
            </div>
          )}
          {section.text !== undefined && <pre className="tr-tool-detail">{section.text}</pre>}
          {section.fields !== undefined && <Fields value={section.fields} />}
        </section>
      ))}
      {sections.length === 0 && (
        <div className="tr-tool-detail-head">
          {t(
            node.status === "running"
              ? "core.transcript.awaiting_output"
              : "core.transcript.no_output",
          )}
        </div>
      )}
      {debug && (
        <details>
          <summary>{t("core.transcript.diagnostics")}</summary>
          <pre className="tr-tool-detail">{JSON.stringify(node.codex, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function CodexTool({
  node,
  sessionId,
  active = true,
}: {
  node: ToolNode;
  sessionId?: string;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const title =
    node.actions?.some((action) => action.kind !== "tool") || node.title
      ? activityToolTitle(node, t)
      : (node.target ?? codexToolTitle(node.tool, node.codex?.input));
  const Icon = node.status === "failed" ? CircleAlert : activityIcons[activityKind(node) ?? "tool"];
  if (isCodexAgentActivity(node.tool))
    return <CodexAgentActivity node={node} sessionId={sessionId} active={active} />;
  return (
    <div className={`tr-tool tr-tool--${node.status}`}>
      <Disclosure
        title={
          <>
            <Icon size={14} aria-hidden="true" />
            <span
              className={`tr-tool-summary${active && node.status === "running" ? " tr-shimmer" : ""}`}
              title={title}
            >
              {title}
            </span>
            {node.status === "failed" && (
              <span className="tr-tool-outcome">{t("core.transcript.failed")}</span>
            )}
            {node.durationMs !== undefined && node.durationMs >= 1000 && (
              <span className="tr-tool-duration">
                {(node.durationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s
              </span>
            )}
          </>
        }
      >
        <Details node={node} />
      </Disclosure>
    </div>
  );
}
