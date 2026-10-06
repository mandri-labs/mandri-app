import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Disclosure } from "./Disclosure";
import { asRecord, outputText, stringAt } from "../parse/shared";
import "./renderers.css";

const PAGE_SIZE = 20;
const eventIds = new WeakMap<object, number>();
let nextEventId = 0;
function eventKey(payload: unknown, index: number): string {
  if (payload !== null && typeof payload === "object") {
    if (!eventIds.has(payload)) eventIds.set(payload, nextEventId++);
    return `event-${eventIds.get(payload)}`;
  }
  return `primitive-${index}`;
}

const RawPayload = memo(function RawPayload({ payload }: { payload: unknown }) {
  const text = useMemo(() => outputText(payload), [payload]);
  return <pre className="tr-raw-payload">{text}</pre>;
});

function TechnicalEvent({ payload, number }: { payload: unknown; number: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const record = asRecord(payload);
  const title =
    stringAt(record, "type") ??
    stringAt(record, "method") ??
    stringAt(record, "event") ??
    t("core.transcript.debug_event", { number });
  return (
    <div className="tr-debug-event">
      <button
        type="button"
        className="tr-debug-event-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? "−" : "+"}</span>
        <span>{title}</span>
      </button>
      {open && <RawPayload payload={payload} />}
    </div>
  );
}

function TechnicalEvents({ events }: { events: unknown[] }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(events.length / PAGE_SIZE) - 1));
  const end = Math.max(0, events.length - currentPage * PAGE_SIZE);
  const start = Math.max(0, end - PAGE_SIZE);
  return (
    <div className="tr-debug-events">
      <div className="tr-debug-page" key={currentPage}>
        {events.slice(start, end).map((payload, index) => (
          <TechnicalEvent
            key={eventKey(payload, start + index)}
            payload={payload}
            number={start + index + 1}
          />
        ))}
      </div>
      {events.length > PAGE_SIZE && (
        <div className="tr-debug-pagination">
          <button type="button" disabled={start === 0} onClick={() => setPage(currentPage + 1)}>
            {t("core.transcript.debug_older")}
          </button>
          <span aria-live="polite">
            {start + 1}–{end} / {events.length}
          </span>
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("core.transcript.debug_newer")}
          </button>
        </div>
      )}
    </div>
  );
}

export interface RawNodeProps {
  harness: string;
  payload: unknown;
  summary?: string;
}
export function RawNode({ payload, summary }: RawNodeProps) {
  const { t } = useTranslation();
  const record = asRecord(payload);
  const type = stringAt(record, "type") ?? stringAt(record, "method") ?? stringAt(record, "event");
  const title =
    type === "session_context"
      ? t("core.transcript.context")
      : (summary ??
        `${t("core.transcript.diagnostics")}${Array.isArray(payload) ? ` (${payload.length})` : type ? ` (${type})` : ""}`);
  return (
    <Disclosure className="tr-diagnostics" title={title}>
      {Array.isArray(payload) ? (
        <TechnicalEvents events={payload} />
      ) : (
        <RawPayload payload={type === "session_context" ? stringAt(record, "text") : payload} />
      )}
    </Disclosure>
  );
}
