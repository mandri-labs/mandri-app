import { CommandIcon } from "./CommandIcon";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import type { NativeCommand } from "@/daemon/types/commands";
import "./commands.css";

export function CommandPalette({ id, commands, active, loading, error, reason, emptyCatalog, onSelect, onRefresh }: {
  id: string; commands: NativeCommand[]; active: number; loading: boolean; error: boolean;
  reason?: string | null; emptyCatalog: boolean; onSelect: (command: NativeCommand) => void; onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [active]);
  return <div className="native-command-palette" ref={ref}>
    {loading ? <p role="status"><LoaderCircle size={14} className="native-command-spin" />{t("commands.loading")}</p> : error ? <p role="alert">{reason || t("commands.unavailable")}</p> : null}
    <div role="listbox" id={id} aria-label={t("commands.title")}>
      {!loading && !error && commands.map((command, index) => <div role="option" id={`${id}-${index}`} key={command.id} aria-selected={index === active} aria-disabled={command.available === false}
        className="native-command-option" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(command)}>
        <CommandIcon command={command} />
        <div><strong>{command.name.replace(/^\//, "")}</strong><span>{command.description}</span>{command.available === false && <small>{command.unavailable_reason || t("commands.blocked")}</small>}</div>
        <ArrowUpRight size={13} aria-hidden="true" />
      </div>)}
    </div>
    {!loading && !error && !commands.length && <p role="status">{emptyCatalog ? reason || t("commands.no_catalog") : t("commands.empty")}</p>}
    <footer><button type="button" onClick={onRefresh} aria-label={t("commands.retry")}><RefreshCw size={13} /></button></footer>
  </div>;
}
