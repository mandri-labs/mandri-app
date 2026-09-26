import { activityIcons } from "./activityIcons";
import { useTranslation } from "react-i18next";
import type { TranscriptNode } from "../parse/types";
import { activityKinds, activityKind, activityToolTitle } from "../activitySummary";
import { presentationKey } from "../presentation";
import { Disclosure, DisclosureKeyContext } from "./Disclosure";
import { TranscriptNodeRenderer } from "./TranscriptNodeRenderer";
import "../shimmer.css";

export function ActivityGroup({
  nodes,
  sessionId,
  active,
  label,
  completedSummary,
}: {
  nodes: readonly TranscriptNode[];
  sessionId: string;
  active: boolean;
  label?: string;
  completedSummary?: string;
}) {
  const { t } = useTranslation();
  const kinds = activityKinds(nodes);
  const current = active
    ? [...nodes]
        .reverse()
        .find(
          (node) => node.kind === "tool" && ["running", "pending", "waiting"].includes(node.status),
        )
    : undefined;
  const kind = current ? activityKind(current) : active ? undefined : kinds[0];
  const Icon = kind ? activityIcons[kind] : null;
  const completedKinds = activityKinds(
    nodes.filter((node) => node.kind !== "tool" || node.status === "done"),
  );
  const outcomes = [
    nodes.some((node) => node.kind === "tool" && node.status === "failed")
      ? t("core.transcript.activities_failed")
      : undefined,
    nodes.some((node) => node.kind === "tool" && node.status === "cancelled")
      ? t("core.transcript.activities_cancelled")
      : undefined,
    nodes.some(
      (node) => node.kind === "tool" && ["pending", "running", "waiting"].includes(node.status),
    )
      ? t("core.transcript.activities_incomplete")
      : undefined,
  ];
  const eventSummary = [
    ...completedKinds.map((kind) => t(`core.transcript.activities_${kind}`)),
    ...outcomes,
  ]
    .filter(Boolean)
    .join(", ");
  const summary =
    label ??
    (active
      ? current?.kind === "tool"
        ? activityToolTitle(current, t)
        : t("core.transcript.thinking")
      : completedSummary ||
        eventSummary.replace(/^./u, (letter) => letter.toLocaleUpperCase()) ||
        t("core.transcript.reasoning"));
  const detailedEdits = new Set(
    nodes.flatMap((node) =>
      node.kind === "diff" && node.key ? [node.callId ?? node.key.split(":diff:")[0]] : [],
    ),
  );
  const visibleNodes = nodes.filter(
    (node) =>
      !(
        node.kind === "tool" &&
        activityKind(node) === "edit" &&
        node.key &&
        detailedEdits.has(node.key)
      ),
  );
  return (
    <Disclosure
      className="tr-activity-group"
      title={
        <>
          {Icon && <Icon size={14} aria-hidden="true" />}
          <span title={summary} className={`tr-activity-title${active ? " tr-shimmer" : ""}`}>
            {summary}
          </span>
        </>
      }
    >
      <div className="tr-activity-group-items">
        {visibleNodes.map((node) => (
          <DisclosureKeyContext.Provider
            key={presentationKey(node)}
            value={`activity:${presentationKey(node)}`}
          >
            <TranscriptNodeRenderer node={node} sessionId={sessionId} active={active} />
          </DisclosureKeyContext.Provider>
        ))}
      </div>
    </Disclosure>
  );
}
