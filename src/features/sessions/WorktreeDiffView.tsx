import { Fragment, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseWorktreeDiff } from "./worktreeDiff";

export function WorktreeDiff({
  diff,
  paths,
  fullscreen,
}: {
  diff: string;
  paths: readonly string[];
  fullscreen: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const files = useMemo(() => parseWorktreeDiff(diff, paths), [diff, paths]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const headers = useRef(new Map<string, HTMLButtonElement>());
  return (
    <div className={`worktree-review${fullscreen ? " worktree-review--fullscreen" : ""}`}>
      {fullscreen && files.length > 0 ? (
        <nav className="worktree-file-nav" aria-label={t("worktree.changed_files")}>
          <div className="settings-menu-heading">{t("worktree.changed_files")}</div>
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              title={file.path}
              onClick={() => {
                setCollapsed((current) => {
                  const next = new Set(current);
                  next.delete(file.path);
                  return next;
                });
                const header = headers.current.get(file.path);
                header?.scrollIntoView({ block: "start" });
                header?.focus({ preventScroll: true });
              }}
            >
              <FileCode2 size={14} aria-hidden="true" />
              <span>{file.path}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <div className="worktree-review-files" role="region" aria-label={t("worktree.diff")}>
        {files.length === 0 ? <p className="worktree-diff-notice">{t("worktree.empty")}</p> : null}
        {files.map((file, index) => {
          const open = !collapsed.has(file.path);
          return (
            <section className="worktree-file" key={file.path}>
              <button
                ref={(element) => {
                  if (element) headers.current.set(file.path, element);
                  else headers.current.delete(file.path);
                }}
                type="button"
                className="worktree-file-heading"
                aria-expanded={open}
                aria-controls={`${id}-${index}`}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (open) next.add(file.path);
                    else next.delete(file.path);
                    return next;
                  })
                }
              >
                <ChevronDown
                  size={14}
                  className={open ? "" : "worktree-file-chevron--closed"}
                  aria-hidden="true"
                />
                <FileCode2 size={15} aria-hidden="true" />
                <span className="worktree-file-path">
                  {file.previousPath && file.previousPath !== file.path ? (
                    <span className="worktree-file-previous">{file.previousPath} → </span>
                  ) : null}
                  {file.path}
                </span>
                <span className="worktree-file-status">{t(`worktree.file_${file.status}`)}</span>
                {file.additions > 0 ? (
                  <span className="worktree-diff-add">+{file.additions}</span>
                ) : null}
                {file.deletions > 0 ? (
                  <span className="worktree-diff-del">−{file.deletions}</span>
                ) : null}
              </button>
              {open ? (
                <div id={`${id}-${index}`} className="worktree-file-content">
                  {file.modeChange ? (
                    <p className="worktree-diff-notice">
                      {t("worktree.file_mode", { mode: file.modeChange })}
                    </p>
                  ) : null}
                  {file.hunks.length ? (
                    <div
                      className="worktree-diff-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label={file.path}
                    >
                      <table className="worktree-diff-table">
                        <tbody>
                          {file.hunks.map((hunk, hunkIndex) => (
                            <Fragment key={hunkIndex}>
                              <tr className="worktree-diff-hunk">
                                <td colSpan={4}>
                                  {t("worktree.hunk_lines", {
                                    old: hunk.oldStart,
                                    new: hunk.newStart,
                                  })}
                                </td>
                              </tr>
                              {hunk.lines.map((line, lineIndex) => (
                                <tr
                                  key={lineIndex}
                                  className={`worktree-diff-line worktree-diff-line--${line.kind}`}
                                >
                                  <td className="worktree-diff-number">{line.oldNumber}</td>
                                  <td className="worktree-diff-number">{line.newNumber}</td>
                                  <td className="worktree-diff-sign">
                                    {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
                                  </td>
                                  <td className="worktree-diff-code">
                                    <code>{line.text || "\u00a0"}</code>
                                  </td>
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="worktree-diff-notice">
                      {t(
                        file.binary
                          ? "worktree.binary_file"
                          : file.unavailable
                            ? "worktree.diff_unavailable"
                            : "worktree.no_text_changes",
                      )}
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
