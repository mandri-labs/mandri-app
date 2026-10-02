import { codexToolTitle } from "./parse/codexToolView";
import type { TFunction } from "i18next";
import type { ActivityKind, TranscriptNode } from "./parse/types";
import { nativeToolActions } from "./parse/nativeTools";

export type { ActivityKind } from "./parse/types";
export type ToolNode = Extract<TranscriptNode, { kind: "tool" }>;

export function toolActions(node: ToolNode) {
  return node.actions?.length ? node.actions : nativeToolActions(node.tool);
}

export function activityKind(node: TranscriptNode): ActivityKind | undefined {
  return node.kind === "diff"
    ? "edit"
    : node.kind === "tool"
      ? toolActions(node)[0]?.kind
      : undefined;
}

export function activityKinds(nodes: readonly TranscriptNode[]): ActivityKind[] {
  const kinds = new Set(
    nodes.flatMap((node) =>
      node.kind === "diff"
        ? ["edit"]
        : node.kind === "tool"
          ? toolActions(node).map((action) => action.kind)
          : [],
    ),
  );
  return (["edit", "read", "list", "search", "web", "command", "tool"] as const).filter((kind) =>
    kinds.has(kind),
  );
}

export function activityToolTitle(node: ToolNode, t: TFunction): string {
  if (node.status === "pending") return t("core.transcript.action_pending", { tool: node.label });
  if (node.title?.trim()) return node.title;
  return [
    ...new Set(
      toolActions(node).map((action) => {
        if (action.kind === "command") return action.target ?? node.target ?? node.label;
        if (action.kind === "tool")
          return node.codex
            ? codexToolTitle(node.tool, node.codex.input)
            : node.target
              ? `${node.label}: ${node.target}`
              : node.label;
        const target = [action.query, action.target ?? node.target].filter(Boolean).join(", ");
        return target
          ? t(`core.transcript.action_${action.kind}`, { target })
          : t(`core.transcript.action_${action.kind}_generic`);
      }),
    ),
  ].join(", ");
}
