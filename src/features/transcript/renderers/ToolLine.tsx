import type { ToolNode } from "../activitySummary";
import { activityKind, activityToolTitle } from "../activitySummary";
import { activityIcons } from "./activityIcons";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Disclosure } from "./Disclosure";
import "./renderers.css";

export type ToolLineStatus = ToolNode["status"];
export interface ToolLineProps {
  active?: boolean;
  node?: ToolNode;
  tool: string;
  label: string;
  target?: string;
  status: ToolLineStatus;
  durationMs?: number;
  additions?: number;
  deletions?: number;
  detailText?: string;
}
export function ToolLine({
  active = true,
  node,
  tool,
  label,
  target,
  status,
  durationMs,
  additions,
  deletions,
  detailText,
}: ToolLineProps) {
  const { t } = useTranslation();
  const entry: ToolNode = node ?? { kind: "tool", tool, label, target, status };
  const Icon = status === "failed" ? CircleAlert : activityIcons[activityKind(entry) ?? "tool"];
  const title = activityToolTitle(entry, t);
  const summary = (
    <>
      <Icon size={14} aria-hidden="true"  />
      <span className={`tr-tool-summary${active && status === "running" ? " tr-shimmer" : ""}`} title={title}>
        {title}
      </span>
      {status === "failed" && (
        <span className="tr-tool-outcome">{t("core.transcript.failed")}</span>
      )}
      {status === "cancelled" && <span className="tr-tool-outcome">{t("core.transcript.action_cancelled")}</span>}
      {active && status === "running" && <span className="sr-only">{t("core.transcript.agent_active")}</span>}
      {durationMs !== undefined && durationMs >= 1000 && (
        <span className="tr-tool-duration">
          {(durationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s
        </span>
      )}
      {additions !== undefined && <span className="tr-tool-add">+{additions}</span>}
      {deletions !== undefined && <span className="tr-tool-del">−{deletions}</span>}
    </>
  );
  return (
    <div className={`tr-tool tr-tool--${status}`}>
      <Disclosure title={summary}>
        <div className="tr-tool-detail-head">{label}</div>
        {target !== undefined && <pre className="tr-tool-command">{target}</pre>}
        <pre className="tr-tool-detail">
          {detailText ??
            t(
              status === "running"
                ? "core.transcript.awaiting_output"
                : "core.transcript.no_output",
            )}
        </pre>
      </Disclosure>
    </div>
  );
}
