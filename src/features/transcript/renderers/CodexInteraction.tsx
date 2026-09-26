import { useTranslation } from "react-i18next";
import { asRecord } from "../parse/shared";
import { codexResultSections } from "../parse/codexToolView";

export function CodexInteraction({
  tool,
  input,
  output,
}: {
  tool: string;
  input: unknown;
  output: unknown;
}) {
  const { t } = useTranslation();
  const record = asRecord(input);
  if (!record) return null;
  if (/(?:^|\.)request_user_input$/.test(tool) && Array.isArray(record.questions)) {
    const result = codexResultSections(output).find((section) => asRecord(section.fields?.answers));
    const answers = asRecord(result?.fields?.answers);
    return (
      <ol className="tr-codex-questions">
        {record.questions.map((value, index) => {
          const question = asRecord(value);
          if (typeof question?.question !== "string") return null;
          const answer = asRecord(answers?.[String(question.id)]);
          const selected = Array.isArray(answer?.answers)
            ? answer.answers.filter((value): value is string => typeof value === "string")
            : [];
          return (
            <li key={index}>
              <p className="tr-codex-question">{question.question}</p>
              {Array.isArray(question.options) && (
                <ul>
                  {question.options.map((value, index) => {
                    const option = asRecord(value);
                    if (typeof option?.label !== "string") return null;
                    return (
                      <li key={index}>
                        <strong>{option.label}</strong>
                        {typeof option.description === "string" && <> — {option.description}</>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {selected.length > 0 && (
                <p className="tr-codex-answer">
                  <strong>{t("core.transcript.answer")}</strong> {selected.join(", ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    );
  }
  return null;
}
