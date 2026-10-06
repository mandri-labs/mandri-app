import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { NativeQuestions, nativeQuestions } from "./NativeQuestions";
import { ApprovalCard } from "./ApprovalCard";

beforeAll(() => initI18n("en"));
afterEach(cleanup);

const raw = {
  properties: {
    questions: [
      {
        header: "Environment",
        question: "Deploy where?",
        custom: false,
        options: [
          { label: "Staging", description: "Review before release" },
          { label: "Production" },
        ],
      },
      {
        question: "Run which checks?",
        multiple: true,
        custom: true,
        options: [{ label: "Unit tests" }, { label: "Integration tests" }],
      },
    ],
  },
};

describe("native questions", () => {
  it("submits every question in native order and keeps multiple and custom selections", () => {
    const onAnswer = vi.fn();
    render(<NativeQuestions harness="opencode" raw={raw} disabled={false} onAnswer={onAnswer} />);
    const submit = screen.getByRole("button");
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Staging/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Unit tests" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Integration tests" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Smoke test" } });
    fireEvent.click(submit);
    expect(onAnswer).toHaveBeenCalledWith([
      { question: "0", answers: ["Staging"] },
      { question: "1", answers: ["Unit tests", "Integration tests", "Smoke test"] },
    ]);
  });

  it("replaces a single choice with custom text and preserves the Claude question key", () => {
    const onAnswer = vi.fn();
    render(
      <NativeQuestions
        harness="claude"
        raw={{
          request: {
            input: {
              questions: [{ question: "Choose destination", options: [{ label: "Local" }] }],
            },
          },
        }}
        disabled={false}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Remote" } });
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button"));
    expect(onAnswer).toHaveBeenCalledWith([
      { question: "Choose destination", answers: ["Remote"] },
    ]);
  });

  it("uses Codex ids and rejects an incomplete native question schema", () => {
    expect(
      nativeQuestions("codex", {
        params: {
          questions: [
            {
              id: "destination",
              question: "Where?",
              options: [{ label: "Local" }],
              isOther: false,
            },
          ],
        },
      })[0],
    ).toMatchObject({ id: "destination", custom: false });
    expect(
      nativeQuestions("codex", { params: { questions: [{ question: "Missing identifier" }] } }),
    ).toEqual([]);
  });

  it("keeps unknown interactions readable and cancellable without raw JSON or allow buttons", () => {
    const onCancel = vi.fn();
    render(
      <ApprovalCard
        approval={{
          approvalId: "unsupported",
          sessionId: "session",
          harness: "codex",
          kind: "unknown",
          raw: { secret: "private payload" },
          deadline: Date.now() + 60000,
          status: "pending",
        }}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByText(/private payload/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not bypass form validation with a generic approval button", () => {
    const onAnswer = vi.fn();
    render(
      <ApprovalCard
        approval={{
          approvalId: "question",
          sessionId: "session",
          harness: "opencode",
          kind: "user_input",
          raw,
          deadline: Date.now() + 60000,
          status: "pending",
        }}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
