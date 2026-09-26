import { parsePatch } from "diff";

export interface ReviewLine {
  kind: "add" | "del" | "context" | "note";
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface ReviewFile {
  path: string;
  previousPath?: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
  binary?: boolean;
  unavailable?: boolean;
  modeChange?: string;
  additions: number;
  deletions: number;
  hunks: { oldStart: number; newStart: number; lines: ReviewLine[] }[];
}

const stripPrefix = (path: string | undefined) => path?.replace(/^[ab]\//, "");

export function parseWorktreeDiff(diff: string, paths: readonly string[]): ReviewFile[] {
  const files: ReviewFile[] = [];
  // A malformed/truncated file must not hide the other files in the review.
  for (const chunk of diff.split(/(?=^diff --git )/m).filter((part) => part.trim())) {
    try {
      for (const patch of parsePatch(chunk)) {
        const oldPath = stripPrefix(patch.oldFileName);
        const newPath = stripPrefix(patch.newFileName);
        const path = newPath && newPath !== "/dev/null" ? newPath : oldPath;
        if (!path || path === "/dev/null") continue;
        const file: ReviewFile = {
          path,
          previousPath: patch.isRename || patch.isCopy ? oldPath : undefined,
          status: patch.isRename
            ? "renamed"
            : patch.isCopy
              ? "copied"
              : patch.isCreate || oldPath === "/dev/null"
                ? "added"
                : patch.isDelete || newPath === "/dev/null"
                  ? "deleted"
                  : "modified",
          binary: patch.isBinary,
          modeChange:
            patch.oldMode && patch.newMode && patch.oldMode !== patch.newMode
              ? `${patch.oldMode} → ${patch.newMode}`
              : undefined,
          additions: 0,
          deletions: 0,
          hunks: [],
        };
        file.hunks = patch.hunks.map((hunk) => {
          let oldNumber = hunk.oldStart;
          let newNumber = hunk.newStart;
          return {
            oldStart: hunk.oldStart,
            newStart: hunk.newStart,
            lines: hunk.lines.map((line): ReviewLine => {
              if (line.startsWith("+")) {
                file.additions++;
                return { kind: "add", text: line.slice(1), newNumber: newNumber++ };
              }
              if (line.startsWith("-")) {
                file.deletions++;
                return { kind: "del", text: line.slice(1), oldNumber: oldNumber++ };
              }
              if (line.startsWith("\\")) return { kind: "note", text: line.slice(2) };
              return {
                kind: "context",
                text: line.slice(1),
                oldNumber: oldNumber++,
                newNumber: newNumber++,
              };
            }),
          };
        });
        files.push(file);
      }
    } catch {
      // The authoritative file list below preserves entries with no usable patch.
    }
  }
  for (const path of paths) {
    if (!files.some((file) => file.path === path || file.previousPath === path)) {
      files.push({
        path,
        status: "modified",
        additions: 0,
        deletions: 0,
        hunks: [],
        unavailable: true,
      });
    }
  }
  return files;
}
