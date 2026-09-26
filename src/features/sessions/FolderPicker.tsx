import { ChevronRight, CornerLeftUp, Folder } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { components } from "@/daemon/types/rest.gen";
import { listFsDir, listFsProjects, listFsRoots } from "@/daemon/rest/fs";
import { errorKey } from "./lifecycle";
import "./folder-picker.css";

type FsEntryOut = components["schemas"]["FsEntryOut"];

const MAX_RECENT_PROJECTS = 5;

export function pathAncestors(path: string): string[] {
  const ancestors: string[] = [];
  const regex = /[\\/]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    if (match.index > 0) {
      ancestors.push(path.slice(0, match.index));
    }
  }
  ancestors.push(path);
  return ancestors.filter((value, index, all) => all.indexOf(value) === index);
}

export function lastPathSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}

export interface FolderPickerProps {
  value: string | null;
  onSelect: (path: string) => void;
}

export function FolderPicker({ value, onSelect }: FolderPickerProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntryOut[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string | null): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const rows = path === null ? await listFsRoots() : await listFsDir(path);
      setCurrent(path);
      setEntries(rows.filter((row) => row.is_dir));
    } catch (caught) {
      setError(t(errorKey(caught)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadDir(null);
    listFsProjects()
      .then((paths) => {
        setProjects(paths);
      })
      .catch(() => undefined);
  }, [loadDir]);

  const ancestors = current === null ? [] : pathAncestors(current);
  const recents = projects.slice(0, MAX_RECENT_PROJECTS);
  return (
    <div className="folder-picker">
      {recents.length > 0 ? (
        <div className="folder-picker-section">
          <span className="folder-picker-section-label">{t("core.start.folder_recents")}</span>
          {recents.map((project) => (
            <button
              key={project}
              type="button"
              className="folder-picker-row"
              title={project}
              onClick={() => {
                onSelect(project);
              }}
            >
              <Folder size={14} aria-hidden="true" />
              <span className="folder-picker-row-label">{lastPathSegment(project)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="folder-picker-section">
        <span className="folder-picker-section-label">{t("core.start.folder_this_pc")}</span>
        <div className="folder-picker-breadcrumb" aria-label={t("core.start.folder_breadcrumb")}>
          {current === null ? (
            <span className="folder-picker-crumb folder-picker-crumb--current">
              {t("core.start.folder_roots")}
            </span>
          ) : (
            ancestors.map((ancestor, index) => (
              <span key={ancestor} className="folder-picker-crumb-wrap">
                {index > 0 ? <ChevronRight size={11} aria-hidden="true" /> : null}
                <button
                  type="button"
                  className={`folder-picker-crumb${
                    index === ancestors.length - 1 ? " folder-picker-crumb--current" : ""
                  }`}
                  title={ancestor}
                  onClick={() => {
                    void loadDir(ancestor);
                  }}
                >
                  {lastPathSegment(ancestor)}
                </button>
              </span>
            ))
          )}
          {current !== null ? (
            <button
              type="button"
              className="folder-picker-up"
              aria-label={t("core.start.folder_up")}
              disabled={ancestors.length < 2}
              onClick={() => {
                const parent = ancestors[ancestors.length - 2];
                if (parent !== undefined) {
                  void loadDir(parent);
                }
              }}
            >
              <CornerLeftUp size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="folder-picker-list" role="listbox" aria-label={t("core.start.folder")}>
          {loading ? (
            <div className="folder-picker-status" role="status">
              {t("core.start.folder_loading")}
            </div>
          ) : null}
          {!loading && entries.length === 0 && error === null ? (
            <div className="folder-picker-status">{t("core.start.folder_none")}</div>
          ) : null}
          {error !== null ? (
            <div className="folder-picker-status folder-picker-status--error" role="alert">
              {error}
            </div>
          ) : null}
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              role="option"
              aria-selected={value === entry.path}
              className="folder-picker-row"
              title={entry.path}
              onClick={() => {
                void loadDir(entry.path);
              }}
              onDoubleClick={() => {
                onSelect(entry.path);
              }}
            >
              <Folder size={14} aria-hidden="true" />
              <span className="folder-picker-row-label">{entry.name}</span>
            </button>
          ))}
        </div>
        <div className="folder-picker-footer">
          <button
            type="button"
            className="folder-picker-confirm"
            disabled={current === null}
            onClick={() => {
              if (current !== null) {
                onSelect(current);
              }
            }}
          >
            {t("core.start.folder_select")}
          </button>
        </div>
      </div>
    </div>
  );
}
