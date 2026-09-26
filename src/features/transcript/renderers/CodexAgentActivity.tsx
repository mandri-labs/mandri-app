import { Bot, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { agentsStore } from "@/stores/agents";
import { asRecord } from "../parse/shared";
import type { TranscriptNode } from "../parse/types";

const actions: Record<string, string> = {
  spawn_agent: "created",
  send_message: "updated",
  followup_task: "updated",
  send_input: "updated",
  wait_agent: "waited",
  wait: "waited",
  interrupt_agent: "interrupted",
  close_agent: "closed",
};

export function isCodexAgentActivity(tool: string): boolean {
  return Object.hasOwn(actions, tool.split(".").at(-1) ?? "");
}

export function CodexAgentActivity({
  node,
  sessionId,
  active = true,
}: {
  node: Extract<TranscriptNode, { kind: "tool" }>;
  sessionId?: string;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const agents = useStore(agentsStore, (state) => state.agents);
  const input = asRecord(node.codex?.input);
  const all = Object.values(agents).filter((agent) => agent.harness === "codex");
  const current = all.find((agent) => agent.session_id === sessionId || agent.id === sessionId);
  const family = all.filter(
    (agent) => agent.parent_session_id === (current?.parent_session_id ?? sessionId),
  );
  const base = current?.task_id ?? "/root";
  const values =
    input?.targets ??
    input?.ids ??
    input?.task_name ??
    input?.target ??
    input?.agent_id ??
    input?.id;
  const targets = (Array.isArray(values) ? values : [values]).flatMap((value) => {
    const target = typeof value === "string" ? value : asRecord(value)?.target;
    if (typeof target !== "string") return [];
    const path = target.startsWith("/") ? target : `${base}/${target}`;
    const agent = family.find(
      (agent) => agent.native_id === target || agent.id === target || agent.task_id === path,
    );
    const task = agent?.task_id?.split("/").at(-1);
    return [agent ? (task ? `${agent.title} (${task})` : agent.title) : target];
  });
  const names = [...new Set(targets)].join(", ") || t("core.transcript.agent_activity.agents");
  const action =
    node.status === "failed"
      ? "failed"
      : node.status === "running"
        ? "running"
        : actions[node.tool.split(".").at(-1)!];
  const text = `${names} : ${t(`core.transcript.agent_activity.${action}`)}`;
  const Icon =
    node.status === "failed" ? CircleAlert : Bot;
  return (
    <div className={`tr-agent-activity tr-agent-activity--${node.status}`}>
      <Icon
        size={16}
        aria-hidden="true"

      />
      <span className={`tr-tool-summary${active && node.status === "running" ? " tr-shimmer" : ""}`} title={text}>
        {text}
      </span>
    </div>
  );
}
