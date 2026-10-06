import { useState } from "react";
import { useTranslation } from "react-i18next";
import { asRecord, stringAt } from "@/features/transcript/parse/shared";
import { NativeInputUnavailable } from "./NativeQuestions";

export function CodexElicitation({
  raw,
  disabled,
  onAccept,
}: {
  raw: unknown;
  disabled: boolean;
  onAccept: (response: string) => void;
}) {
  const { t } = useTranslation();
  const params = asRecord(asRecord(raw)?.["params"]);
  const schema = asRecord(params?.["requestedSchema"]);
  const properties = asRecord(schema?.["properties"]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [json, setJson] = useState("{}");
  const url = stringAt(params, "url");
  if (params?.["mode"] === "url" && url && /^https?:\/\//.test(url)) {
    return (
      <div className="native-questions">
        <p>{stringAt(params, "message")}</p>
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
        <button
          type="button"
          className="approval-decision approval-decision--allow"
          disabled={disabled}
          onClick={() => onAccept(JSON.stringify({ action: "accept" }))}
        >
          {t("core.approvals.decision_accept")}
        </button>
      </div>
    );
  }
  if (!schema) return <NativeInputUnavailable />;
  const fields = Object.entries(properties ?? {}).map(([key, value]) => ({
    key,
    schema: asRecord(value),
  }));
  const simple =
    schema["type"] === "object" &&
    fields.every(
      ({ schema: field }) =>
        field && ["string", "number", "integer", "boolean"].includes(String(field["type"])),
    );
  let content: Record<string, unknown> | undefined;
  if (simple) {
    content = Object.fromEntries(
      fields
        .filter(({ key }) => values[key] !== undefined && values[key] !== "")
        .map(({ key, schema: field }) => [
          key,
          field?.["type"] === "boolean"
            ? values[key] === "true"
            : ["number", "integer"].includes(String(field?.["type"]))
              ? Number(values[key])
              : values[key],
        ]),
    );
  } else {
    try {
      content = asRecord(JSON.parse(json));
    } catch {
      content = undefined;
    }
  }
  const required = Array.isArray(schema["required"]) ? schema["required"] : [];
  const complete =
    content !== undefined &&
    required.every((key) => typeof key === "string" && content![key] !== undefined);
  return (
    <form
      className="native-questions"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && complete) onAccept(JSON.stringify({ action: "accept", content }));
      }}
    >
      <p>{stringAt(params, "message")}</p>
      {simple ? (
        fields.map(({ key, schema: field }) => {
          const options = Array.isArray(field?.["enum"])
            ? field["enum"]
            : field?.["type"] === "boolean"
              ? [true, false]
              : undefined;
          return (
            <label className="approval-question-freeform" key={key}>
              {stringAt(field, "title") ?? key}
              {stringAt(field, "description") ? (
                <span className="approval-question-description">
                  {stringAt(field, "description")}
                </span>
              ) : null}
              {options ? (
                <select
                  value={values[key] ?? ""}
                  disabled={disabled}
                  required={required.includes(key)}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                >
                  <option value="">{t("core.approvals.choose_answer")}</option>
                  {options.map((value) => (
                    <option key={String(value)} value={String(value)}>
                      {String(value)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field?.["type"] === "string" ? "text" : "number"}
                  step={field?.["type"] === "integer" ? 1 : "any"}
                  min={typeof field?.["minimum"] === "number" ? field["minimum"] : undefined}
                  max={typeof field?.["maximum"] === "number" ? field["maximum"] : undefined}
                  disabled={disabled}
                  required={required.includes(key)}
                  value={values[key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              )}
            </label>
          );
        })
      ) : (
        <label className="approval-question-freeform">
          {t("core.approvals.structured_response")}
          <pre className="approval-command">{JSON.stringify(schema, null, 2)}</pre>
          <textarea
            value={json}
            disabled={disabled}
            onChange={(event) => setJson(event.target.value)}
          />
        </label>
      )}
      <button
        type="submit"
        className="approval-decision approval-decision--allow"
        disabled={disabled || !complete}
      >
        {t("core.approvals.submit_answers")}
      </button>
    </form>
  );
}
