import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalAnswerParams } from "@/daemon/types/ws";
import { asArray, asRecord, stringAt } from "@/features/transcript/parse/shared";

export function agyToolCall(raw: unknown): Record<string, unknown> | undefined {
  const record = asRecord(raw);
  return asRecord(record?.["toolCall"] ?? asRecord(record?.["data"])?.["toolCall"]);
}

export function AgyQuestions({
  raw,
  disabled,
  onAnswer,
}: {
  raw: unknown;
  disabled: boolean;
  onAnswer: (answers: NonNullable<ApprovalAnswerParams["answers"]>) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [freeform, setFreeform] = useState<Record<number, string>>({});
  const questions = (asArray(asRecord(agyToolCall(raw)?.["args"])?.["questions"]) ?? []).flatMap(
    (value) => {
      const record = asRecord(value);
      const question = stringAt(record, "question");
      return question
        ? [
            {
              question,
              multi: record?.["is_multi_select"] === true,
              options: (asArray(record?.["options"]) ?? []).flatMap((option) => {
                const label =
                  typeof option === "string" ? option : stringAt(asRecord(option), "label");
                return label ? [label] : [];
              }),
            },
          ]
        : [];
    },
  );
  const answers = questions.map(({ question }, index) => ({
    question,
    answers: [
      ...(selected[index] ?? []),
      ...(freeform[index]?.trim() ? [freeform[index]!.trim()] : []),
    ],
  }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer(answers);
      }}
    >
      {questions.map((question, index) => (
        <fieldset key={index} disabled={disabled} className="approval-question">
          <legend>{question.question}</legend>
          {question.options.map((option) => (
            <label key={option}>
              <input
                type={question.multi ? "checkbox" : "radio"}
                name={`question-${index}`}
                value={option}
                checked={(selected[index] ?? []).includes(option)}
                onChange={(event) =>
                  setSelected((current) => ({
                    ...current,
                    [index]: question.multi
                      ? event.target.checked
                        ? [...(current[index] ?? []), option]
                        : (current[index] ?? []).filter((value) => value !== option)
                      : [option],
                  }))
                }
              />
              {option}
            </label>
          ))}
          <label>
            {t("core.approvals.freeform_answer")}
            <textarea
              value={freeform[index] ?? ""}
              onChange={(event) =>
                setFreeform((current) => ({ ...current, [index]: event.target.value }))
              }
            />
          </label>
        </fieldset>
      ))}
      <button
        type="submit"
        className="approval-decision approval-decision--allow"
        disabled={disabled || !answers.length || answers.some((answer) => !answer.answers.length)}
      >
        {t("core.approvals.submit_answers")}
      </button>
    </form>
  );
}
