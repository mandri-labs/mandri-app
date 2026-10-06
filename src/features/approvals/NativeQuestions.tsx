import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalAnswerParams } from "@/daemon/types/ws";
import type { ApprovalView } from "@/stores/approvals";
import { asArray, asRecord, stringAt } from "@/features/transcript/parse/shared";
import { agyToolCall } from "./AgyQuestions";

interface NativeQuestion {
  id: string;
  question: string;
  header?: string;
  multiple: boolean;
  custom: boolean;
  secret: boolean;
  prefill?: string;
  placeholder?: string;
  editor?: boolean;
  options: { label: string; description?: string }[];
}

export function nativeQuestions(harness: ApprovalView["harness"], raw: unknown): NativeQuestion[] {
  const record = asRecord(raw);
  if (harness === "pi" && record?.["type"] === "extension_ui_request") {
    const id = stringAt(record, "id");
    const method = stringAt(record, "method");
    if (!id || !["select", "input", "editor"].includes(method ?? "")) return [];
    return [
      {
        id,
        question: stringAt(record, "title") ?? method!,
        multiple: false,
        custom: method !== "select",
        secret: false,
        editor: method === "editor",
        prefill: stringAt(record, "prefill"),
        placeholder: stringAt(record, "placeholder"),
        options: (asArray(record["options"]) ?? []).flatMap((value) =>
          typeof value === "string" ? [{ label: value }] : [],
        ),
      },
    ];
  }
  const container =
    harness === "claude"
      ? asRecord(asRecord(record?.["request"])?.["input"])
      : harness === "opencode"
        ? asRecord(record?.["properties"])
        : harness === "agy"
          ? asRecord(agyToolCall(raw)?.["args"])
          : asRecord(record?.["params"]);
  const values = asArray(container?.["questions"]) ?? [];
  const questions = values.flatMap((value, index) => {
    const item = asRecord(value);
    const question = stringAt(item, "question");
    const id =
      harness === "opencode"
        ? String(index)
        : harness === "codex"
          ? stringAt(item, "id")
          : question;
    if (!question || !id) return [];
    const options = (asArray(item?.["options"]) ?? []).flatMap((option) => {
      const label = typeof option === "string" ? option : stringAt(asRecord(option), "label");
      return label ? [{ label, description: stringAt(asRecord(option), "description") }] : [];
    });
    return [
      {
        id,
        question,
        header: stringAt(item, "header"),
        options,
        multiple:
          item?.["multiple"] === true ||
          item?.["multiSelect"] === true ||
          item?.["is_multi_select"] === true,
        custom:
          harness === "opencode"
            ? item?.["custom"] !== false
            : harness === "codex"
              ? options.length === 0 || item?.["isOther"] === true
              : true,
        secret: item?.["isSecret"] === true,
      },
    ];
  });
  return questions.length === values.length &&
    new Set(questions.map((question) => question.id)).size === questions.length
    ? questions
    : [];
}

export function NativeInputUnavailable() {
  const { t } = useTranslation();
  return (
    <p className="approval-input-unavailable" role="status">
      {t("core.approvals.input_unavailable", {
        defaultValue: "This native interaction is not supported yet. Cancel it to continue.",
      })}
    </p>
  );
}

export function NativeQuestions({
  harness,
  raw,
  disabled,
  onAnswer,
}: {
  harness: ApprovalView["harness"];
  raw: unknown;
  disabled: boolean;
  onAnswer: (answers: NonNullable<ApprovalAnswerParams["answers"]>) => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const questions = nativeQuestions(harness, raw);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeform, setFreeform] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      questions.filter((q) => q.prefill !== undefined).map((q) => [q.id, q.prefill!]),
    ),
  );
  const answers = questions.map(({ id, custom }) => ({
    question: id,
    answers:
      harness === "pi" && custom
        ? [freeform[id] ?? ""]
        : [...(selected[id] ?? []), ...(freeform[id]?.trim() ? [freeform[id]!.trim()] : [])],
  }));
  const complete = answers.length > 0 && answers.every((answer) => answer.answers.length > 0);
  if (!questions.length) return <NativeInputUnavailable />;
  return (
    <form
      className="native-questions"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && complete) onAnswer(answers);
      }}
    >
      {questions.map((question) => (
        <fieldset key={question.id} disabled={disabled} className="approval-question">
          <legend>
            {question.header ? (
              <span className="approval-question-header">{question.header}</span>
            ) : null}
            {question.question}
          </legend>
          {question.multiple ? (
            <p className="approval-question-hint">
              {t("core.approvals.choose_multiple", { defaultValue: "Choose all that apply" })}
            </p>
          ) : null}
          {question.options.map((option) => (
            <label className="approval-question-option" key={option.label}>
              <input
                type={question.multiple ? "checkbox" : "radio"}
                name={`${formId}-${question.id}`}
                value={option.label}
                checked={(selected[question.id] ?? []).includes(option.label)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((current) => ({
                    ...current,
                    [question.id]: question.multiple
                      ? checked
                        ? [...(current[question.id] ?? []), option.label]
                        : (current[question.id] ?? []).filter((value) => value !== option.label)
                      : [option.label],
                  }));
                  if (!question.multiple)
                    setFreeform((current) => ({ ...current, [question.id]: "" }));
                }}
              />
              <span>
                <strong>{option.label}</strong>
                {option.description ? (
                  <span className="approval-question-description">{option.description}</span>
                ) : null}
              </span>
            </label>
          ))}
          {question.custom ? (
            <label className="approval-question-freeform">
              {t("core.approvals.freeform_answer")}
              {question.secret ? (
                <input
                  type="password"
                  autoComplete="off"
                  value={freeform[question.id] ?? ""}
                  onChange={(event) => {
                    setFreeform((current) => ({ ...current, [question.id]: event.target.value }));
                    if (!question.multiple)
                      setSelected((current) => ({ ...current, [question.id]: [] }));
                  }}
                />
              ) : (
                <textarea
                  rows={question.editor ? 8 : 2}
                  placeholder={question.placeholder}
                  value={freeform[question.id] ?? ""}
                  onChange={(event) => {
                    setFreeform((current) => ({ ...current, [question.id]: event.target.value }));
                    if (!question.multiple)
                      setSelected((current) => ({ ...current, [question.id]: [] }));
                  }}
                />
              )}
            </label>
          ) : null}
        </fieldset>
      ))}
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
