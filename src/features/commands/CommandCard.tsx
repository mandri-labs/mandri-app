import { CommandIcon } from "./CommandIcon";
import { Check, CircleAlert, LoaderCircle, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommandInvocation } from "@/daemon/types/commands";
import { MarkdownText } from "@/features/transcript/renderers/MarkdownText";
import "./commands.css";

export function CommandCard({ invocation, onCancel, onClose }: { invocation: CommandInvocation; onCancel?: () => void; onClose?: () => void }) {
  const { t } = useTranslation();
  const { state, command, result } = invocation;
  return <article className="native-command-card" data-state={state} aria-label={`/${command.name}`}>
    <header>
      <CommandIcon command={command} size={17} />
      <strong>/{command.name.replace(/^\//, "")}</strong>
      <span className="native-command-state" role="status">
        {state === "running" ? <LoaderCircle className="native-command-spin" size={13} aria-hidden="true" /> : state === "succeeded" ? <Check size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
        {t(`commands.${state}`)}
      </span>
      {onClose && <button type="button" className="native-command-close" aria-label={t("commands.close")} onClick={onClose}><X size={15} aria-hidden="true" /></button>}
    </header>
    {invocation.arguments && <p className="native-command-arguments">{invocation.arguments}</p>}
    {result?.title && <h3>{result.title}</h3>}
    {result?.kind === "text" && result.text && <MarkdownText text={result.text} />}
    {result?.kind === "list" && (result.items?.length ? <ul className="native-command-items">{result.items.map((item, index) => <li key={index}><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</li>)}</ul> : <p>{result.empty_message || t("commands.empty_result")}</p>)}
    {result?.kind === "fields" && <dl className="native-command-fields">{result.fields?.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.value === null ? "—" : String(field.value)}</dd></div>)}</dl>}
    {result?.kind === "notice" && <p>{result.text || result.message || t("commands.empty_result")}</p>}
    {state === "running" && <p className="native-command-muted">{command.description}</p>}
    {invocation.error && <p role="alert">{invocation.error}</p>}
    {invocation.cancellable && onCancel && <button type="button" className="native-command-action" onClick={onCancel}><Square size={12} aria-hidden="true" />{t("commands.cancel")}</button>}
  </article>;
}
