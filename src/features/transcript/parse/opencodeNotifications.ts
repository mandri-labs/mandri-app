import type { TranscriptNode } from "./types";

export function opencodeNotification(text: string) {
  const shell =
    /^<shell id="([^"\r\n]+)" state="([^"\r\n]+)" command="([\s\S]*?)">\r?\n([\s\S]*)\r?\n<\/shell>$/.exec(
      text.trim(),
    );
  if (shell)
    return {
      tool: "shell",
      id: shell[1]!,
      state: shell[2]!,
      target: shell[3]!,
      output: shell[4]!,
    };
  const subagent =
    /^<subagent sessionID="([^"\r\n]+)" state="([^"\r\n]+)"(?: description="([\s\S]*?)")?>\r?\n([\s\S]*)\r?\n<\/subagent>$/.exec(
      text.trim(),
    );
  if (subagent)
    return {
      tool: "subagent",
      id: subagent[1]!,
      state: subagent[2]!,
      target: subagent[3],
      output: subagent[4]!,
    };
  return undefined;
}

export function opencodeNotificationNode(text: string, key?: string): TranscriptNode | undefined {
  const task = opencodeNotification(text);
  if (!task) return undefined;
  return {
    kind: "tool",
    tool: task.tool,
    label: task.tool,
    title: task.tool === "subagent" ? task.target : undefined,
    target: task.target,
    status:
      task.state === "completed"
        ? "done"
        : task.state === "error"
          ? "failed"
          : task.state === "cancelled"
            ? "cancelled"
            : "running",
    actions: [{ kind: task.tool === "shell" ? "command" : "tool", target: task.target }],
    detailText:
      task.output.trim() === "(no output)" || !task.output.trim() ? undefined : task.output,
    details: { output: task.output },
    native: {
      metadata: { [task.tool === "shell" ? "shellID" : "sessionID"]: task.id, state: task.state },
    },
    key,
  };
}
