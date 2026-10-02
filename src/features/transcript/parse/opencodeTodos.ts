import type { TranscriptNode, TranscriptPlanStepStatus } from "./types";
import { asArray, asRecord, stringAt } from "./shared";

const statuses: Record<string, TranscriptPlanStepStatus> = {
  pending: "waiting",
  in_progress: "running",
  completed: "done",
  cancelled: "cancelled",
};

export function opencodeTodos(part: Record<string, unknown>): TranscriptNode | undefined {
  if (part.tool !== "todowrite" && part.tool !== "todoread") return undefined;
  const state = asRecord(part.state);
  if (state?.status === "error") return undefined;
  const input = asRecord(state?.input);
  const metadata = asRecord(state?.metadata);
  let todos = asArray(metadata?.todos) ?? asArray(input?.todos);
  if (!todos && typeof state?.output === "string") {
    try { todos = asArray(JSON.parse(state.output)); } catch { return undefined; }
  }
  if (!todos) return undefined;
  const steps = todos.map((value) => {
    const todo = asRecord(value);
    const text = stringAt(todo, "content");
    const status = statuses[stringAt(todo, "status") ?? ""];
    return text && status ? { text, status } : undefined;
  });
  if (steps.some((step) => step === undefined)) return undefined;
  return { kind: "plan", steps: steps.filter((step) => step !== undefined),
    key: stringAt(part, "callID") ?? stringAt(part, "id") };
}
