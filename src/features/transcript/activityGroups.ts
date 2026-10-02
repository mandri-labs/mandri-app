import type { TranscriptNode } from "./parse/types";
import { transcriptRowKey } from "./presentation";

export type ActivityRow =
  | { kind: "node"; node: TranscriptNode; key: string; index: number }
  | {
      kind: "group";
      nodes: TranscriptNode[];
      key: string;
      index: number;
      active: boolean;
      summary?: string;
    }
  | { kind: "files"; nodes: TranscriptNode[]; key: string; index: number };

export function groupActivities(
  nodes: readonly TranscriptNode[],
  working: boolean,
  activeStart: number,
  turnStarts: ReadonlySet<number> = new Set(),
  fileSummaryAllowed = !working,
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let files: TranscriptNode[] = [];
  let scope = "initial";
  let segmentActive = false;
  let sessionSnapshot: Extract<TranscriptNode, { kind: "file_snapshot" }> | undefined;
  const summaries = nodes.filter((node) => node.kind === "activity_summary");
  let hasEdits = false;
  const flushFiles = (index: number) => {
    if (files.length && !working && fileSummaryAllowed && !segmentActive)
      rows.push({ kind: "files", nodes: files, key: `files:${scope}`, index });
    files = [];
    segmentActive = false;
  };
  for (const [index, node] of nodes.entries()) {
    const boundary = node.kind === "user" || turnStarts.has(index);
    if (boundary) {
      if (turnStarts.has(index) || !segmentActive) {
        flushFiles(index);
        scope = transcriptRowKey(node);
      }
    }
    segmentActive ||= working && index >= activeStart;
    if (node.kind === "activity_summary") continue;
    if (node.kind === "file_snapshot") {
      if (node.scope === "session") sessionSnapshot = node;
      else files = [node];
      continue;
    }
    if (node.kind === "diff") {
      files.push(node);
      hasEdits = true;
    }
    const key = transcriptRowKey(node);
    if (["tool", "diff", "plan"].includes(node.kind)) {
      const previous = rows.at(-1);
      const active =
        working &&
        index >= activeStart &&
        (index === nodes.length - 1 ||
          (node.kind === "tool" && ["running", "pending", "waiting"].includes(node.status)));
      if (!boundary && previous?.kind === "group") {
        previous.nodes.push(node);
        previous.active ||= active;
      } else {
        rows.push({ kind: "group", nodes: [node], key: `group:${key}`, index, active });
      }
    } else {
      rows.push({ kind: "node", node, key, index });
    }
  }
  flushFiles(nodes.length);
  if (!working && fileSummaryAllowed && !hasEdits && sessionSnapshot?.files.length)
    rows.push({
      kind: "files",
      key: "files:session",
      nodes: [sessionSnapshot],
      index: nodes.length,
    });
  const foreground = [...rows].reverse().find((row) => row.kind === "group" ||
    (row.kind === "node" && ["user", "assistant", "thinking"].includes(row.node.kind)));
  for (const row of rows) {
    if (row.kind !== "group") continue;
    row.active &&= row === foreground;
    const calls = row.nodes.filter((node) => node.kind === "tool");
    const summary = [...summaries]
      .reverse()
      .find(
        (summary) =>
          calls.length > 0 &&
          calls.every(
            (call) =>
              call.key &&
              summary.callIds.includes(call.native?.callId ?? call.key) &&
              call.native?.parentCallId === summary.parentCallId,
          ) &&
          summary.callIds.every((id) =>
            calls.some((call) => (call.native?.callId ?? call.key) === id),
          ),
      );
    row.summary = summary?.text;
    if (summary && calls.every((call) => ["done", "failed", "cancelled"].includes(call.status)))
      row.active = false;
    if (working && row === rows.at(-1) && !summary && row.index >= activeStart) row.active = true;
  }
  return rows;
}
