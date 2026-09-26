import { diffArrays } from "diff";
import type { SessionView } from "@/stores/sessions";
import type { TranscriptDiff, TranscriptDiffLine, TranscriptNode } from "./parse/types";
import { isSessionWorking } from "./turnActivity";

export function canShowFileSummary(session: SessionView | undefined): boolean {
  if (!session) return false;
  const external = session.availability;
  // Opening external history must not briefly imply completion before its
  // writer status has arrived.
  const awaitingExternalStatus = session.state === "discovered" &&
    session.externalBusy !== false && external?.activity !== "idle";
  return !(
    awaitingExternalStatus ||
    isSessionWorking(session) ||
    session.externalBusy === true ||
    session.sending ||
    session.awaitingResponse ||
    session.stopping ||
    ["checking", "preparing_image", "preparing_state", "starting"].includes(session.executionPhase ?? "") ||
    external?.activity === "busy" ||
    (external?.owner === "external" && external.activity !== "idle")
  );
}

export interface ConsolidatedFile {
  path: string;
  oldPath?: string;
  change?: TranscriptDiff["change"];
  additions?: number;
  deletions?: number;
  lines?: TranscriptDiffLine[];
  unavailable?: boolean;
}

type Line = { text?: string; original?: number };
const MAX_LINES = 200_000;

function combine(changes: TranscriptDiff[]): ConsolidatedFile {
  const last = changes.at(-1)!;
  if (changes.length === 1) return last;
  const unavailable = { path: last.path, unavailable: true };
  const original: Line[] = [];
  const current: Line[] = [];
  const created = changes[0]?.change === "add";
  if (created && last.change === "delete") return { path: last.path, additions: 0, deletions: 0 };
  const ensure = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_LINES) return false;
    if (created && length > current.length) return false;
    while (current.length < length) {
      const line = { original: original.length + 1 };
      original.push(line);
      current.push(line);
    }
    return true;
  };
  for (const change of changes) {
    if (!change.lines?.length) return unavailable;
    let offset = 0;
    for (const line of change.lines) {
      if (line.type === "add") {
        const index = (line.newNo ?? 0) - 1;
        if (!ensure(index)) return unavailable;
        current.splice(index, 0, { text: line.text });
        offset++;
      } else {
        const index = (line.oldNo ?? 0) - 1 + offset;
        if (line.oldNo === undefined || index < 0 || !ensure(index + 1)) return unavailable;
        const existing = current[index]!;
        if (existing.text !== undefined && existing.text !== line.text) return unavailable;
        existing.text = line.text;
        if (line.type === "del") {
          current.splice(index, 1);
          offset--;
        }
      }
    }
  }
  const delta = diffArrays(original, current, {
    comparator: (a, b) =>
      a === b || (a.text !== undefined && b.text !== undefined && a.text === b.text),
    timeout: 40,
    maxEditLength: 20_000,
  });
  if (!delta) return unavailable;
  const lines: TranscriptDiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  let additions = 0;
  let deletions = 0;
  for (const part of delta) {
    for (const line of part.value) {
      const type = part.added ? "add" : part.removed ? "del" : "context";
      if (line.text !== undefined)
        lines.push({
          type,
          text: line.text,
          oldNo: part.added ? undefined : oldNo,
          newNo: part.removed ? undefined : newNo,
        });
      if (part.added) additions++;
      if (part.removed) deletions++;
      if (!part.added) oldNo++;
      if (!part.removed) newNo++;
    }
  }
  return {
    path: last.path,
    additions,
    deletions,
    lines,
    change: created ? "add" : last.change,
    oldPath: changes.find((change) => change.oldPath)?.oldPath,
  };
}

export function consolidateFiles(nodes: readonly TranscriptNode[]): ConsolidatedFile[] {
  const files = new Map<string, TranscriptDiff[]>();
  const pathKey = (path: string) => path.replaceAll("\\", "/");
  for (const node of nodes) {
    if (node.kind === "user") files.clear();
    if (node.kind === "file_snapshot") {
      files.clear();
      for (const file of node.files) files.set(pathKey(file.path), [file]);
    }
    if (node.kind !== "diff") continue;
    const key = pathKey(node.path);
    const previousKey = node.oldPath ? pathKey(node.oldPath) : key;
    const changes = files.get(previousKey) ?? [];
    if (previousKey !== key) files.delete(previousKey);
    files.set(key, [...changes.filter((change) => !node.key || change.key !== node.key), node]);
  }
  return [...files.values()]
    .map(combine)
    .filter(
      (file) =>
        file.unavailable ||
        file.oldPath ||
        file.change === "add" ||
        file.change === "delete" ||
        file.additions !== 0 ||
        file.deletions !== 0,
    );
}
