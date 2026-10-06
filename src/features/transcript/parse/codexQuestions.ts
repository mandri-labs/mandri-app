import { asArray, asRecord, stringAt } from "./shared";
import type { AsyncQuestion } from "./types";

export function parseAsyncQuestions(value: unknown): AsyncQuestion[] | undefined {
  const questions = (asArray(value) ?? []).flatMap((value) => {
    const record = asRecord(value);
    const title = stringAt(record, "title");
    if (!title?.trim()) return [];
    const options = (asArray(record?.["options"]) ?? []).filter(
      (option): option is string => typeof option === "string" && !!option.trim(),
    );
    return [{ title, options }];
  });
  return questions.length ? questions : undefined;
}

export function asyncQuestionText(questions: readonly AsyncQuestion[]): string {
  return questions
    .map(({ title, options }) => [title, ...options.map((option) => `- ${option}`)].join("\n"))
    .join("\n\n");
}
