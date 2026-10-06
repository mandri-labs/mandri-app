import { expect, it } from "vitest";
import { parseClaudeEvent, parseClaudeHistoryLine } from "@/features/transcript/parse/claude";
import { nativeTurnActivity } from "@/features/transcript/turnActivity";

const content = [
  {
    type: "text",
    text: "[Your previous response had no visible output. Please continue and produce a user-visible response.]",
  },
];

it.each(["isMeta", "isSynthetic", "turnCompanion"])(
  "does not render Claude %s instructions as a user message",
  (flag) => {
    const raw = {
      type: "user",
      [flag]: true,
      message: { role: "user", content },
      session_id: "native",
    };
    expect(parseClaudeEvent(raw, "claude")).toEqual([]);
    expect(parseClaudeHistoryLine(JSON.stringify(raw), "claude")).toEqual([]);
    expect(nativeTurnActivity("claude", "native", raw)).toBe(true);
  },
);

it("keeps identical text when it is an actual user message", () => {
  const raw = { type: "user", message: { role: "user", content } };
  expect(parseClaudeEvent(raw, "claude")).toEqual([{ kind: "user", text: content[0]!.text }]);
  expect(parseClaudeHistoryLine(JSON.stringify(raw), "claude")).toEqual([
    { kind: "user", text: content[0]!.text },
  ]);
});
