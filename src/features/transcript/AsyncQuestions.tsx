import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AsyncQuestion, TranscriptNode } from "./parse/types";
import "@/features/approvals/approvals.css";
import "./async-questions.css";

export function pendingAsyncQuestion(nodes: readonly TranscriptNode[]) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (node.kind === "user") return undefined;
    if (node.kind === "assistant" && node.questions?.length) return node;
  }
  return undefined;
}

export function AsyncQuestions({
  questions,
  disabled,
  onAnswer,
}: {
  questions: readonly AsyncQuestion[];
  disabled: boolean;
  onAnswer: (answer: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, number>>({});
  const answerAt = (index: number) => {
    const question = questions[index]!;
    return question.options.length === 0 || selected[index] === -1
      ? (answers[index]?.trim() ?? "")
      : (question.options[selected[index]!] ?? "");
  };
  return (
    <section
      className="session-approvals async-question-panel"
      aria-label={t("core.approvals.kind_user_input")}
    >
      <form
        className="approval-card async-questions"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || questions.some((_, index) => !answerAt(index))) return;
          onAnswer(
            questions
              .map((question, index) => `${question.title}\n${answerAt(index)}`)
              .join("\n\n"),
          );
        }}
      >
        <header className="approval-card-header">
          <span className="approval-kind">{t("core.approvals.kind_user_input")}</span>
        </header>
        <div className="async-question-fields">
          {questions.map((question, index) => (
            <fieldset key={index} disabled={disabled}>
              <legend>{question.title}</legend>
              {question.options.map((option, optionIndex) => (
                <label className="async-question-option" key={optionIndex}>
                  <input
                    type="radio"
                    name={`${id}-${index}`}
                    checked={selected[index] === optionIndex}
                    onChange={() => setSelected({ ...selected, [index]: optionIndex })}
                  />
                  <span>{option}</span>
                </label>
              ))}
              {question.options.length > 0 && (
                <label className="async-question-option async-question-other">
                  <input
                    type="radio"
                    name={`${id}-${index}`}
                    checked={selected[index] === -1}
                    onChange={() => setSelected({ ...selected, [index]: -1 })}
                  />
                  <span>{t("core.transcript.other_answer")}</span>
                </label>
              )}
              {(question.options.length === 0 || selected[index] === -1) && (
                <textarea
                  aria-label={t("core.transcript.free_answer", { number: index + 1 })}
                  placeholder={t("core.transcript.free_answer", { number: index + 1 })}
                  value={answers[index] ?? ""}
                  onChange={(event) => setAnswers({ ...answers, [index]: event.target.value })}
                />
              )}
            </fieldset>
          ))}
        </div>
        <footer className="approval-actions">
          <button
            type="submit"
            className="approval-decision approval-decision--allow"
            disabled={disabled || questions.some((_, index) => !answerAt(index))}
          >
            {t("core.transcript.send_answer")}
          </button>
        </footer>
      </form>
    </section>
  );
}
