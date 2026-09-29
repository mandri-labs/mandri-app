import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { TranscriptNode } from "../parse/types";
import { AssistantText } from "./AssistantText";
import { DiffCard } from "./DiffCard";
import { PlanSteps } from "./PlanSteps";
import { RawNode } from "./RawNode";
import { SystemBanner } from "./SystemBanner";
import { ThinkingLine } from "./ThinkingLine";
import { ToolLine } from "./ToolLine";
import { CodexTool } from "./CodexTool";
import { UserBubble } from "./UserBubble";
import { TranscriptRecord } from "./TranscriptRecord";

export interface TranscriptNodeRendererProps {
  node: TranscriptNode;
  sessionId?: string;
  active?: boolean;
  thinkingActive?: boolean;
}

export const TranscriptNodeRenderer = memo(function TranscriptNodeRenderer({
  node,
  sessionId,
  active = true,
  thinkingActive = false,
}: TranscriptNodeRendererProps) {
  const { t } = useTranslation();
  switch (node.kind) {
    case "record":
      return (
        <TranscriptRecord
          preview={node.preview}
          byteLength={node.byteLength}
          eventKind={node.eventKind}
        />
      );
    case "user":
      return <UserBubble text={node.text} images={node.localPresentation?.images ?? node.images} sessionId={sessionId} />;
    case "assistant":
      return <AssistantText text={node.text} sessionId={sessionId} streaming={active && node.streaming} />;
    case "thinking":
      return <ThinkingLine text={node.text} active={thinkingActive} />;
    case "tool":
      if (node.codex) return <CodexTool node={node} sessionId={sessionId} active={active} />;
      return (
        <ToolLine
          node={node}
          active={active}
          tool={node.tool}
          label={node.label}
          target={node.target ?? node.path}
          status={node.status}
          durationMs={node.durationMs}
          detailText={node.detailText}
          additions={node.additions}
          deletions={node.deletions}
        />
      );
    case "diff":
      return (
        <DiffCard
          path={node.path}
          additions={node.additions}
          deletions={node.deletions}
          lines={node.lines}
        />
      );
    case "plan":
      return <PlanSteps steps={node.steps} />;
    case "system":
      return (
        <SystemBanner
          level={node.level}
          compacted={node.messageKey === "commands.compacted"}
          text={node.messageKey ? t(node.messageKey, node.values ?? {}) : node.text}
        />
      );
    case "raw":
      return <RawNode harness={node.harness} payload={node.payload} />;
    default:
      return null;
  }
});
