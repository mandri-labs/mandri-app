import { expect, it } from "vitest";
import { parseClaudeEvent, parseClaudeHistoryLine } from "@/features/transcript/parse/claude";

it.each(["user", "assistant"] as const)(
  "reads %s string content with the same identity as text blocks",
  (type) => {
    const message = { type, uuid: "fragment", message: { id: "message", content: "Hello" } };
    const blocks = {
      ...message,
      message: { ...message.message, content: [{ type: "text", text: "Hello" }] },
    };
    const expected = parseClaudeEvent(blocks, "claude");
    expect(expected).toHaveLength(1);
    expect(parseClaudeEvent(message, "claude")).toEqual(expected);
    expect(parseClaudeHistoryLine(JSON.stringify(message), "claude")).toEqual(expected);
    expect(
      parseClaudeEvent({ ...message, message: undefined, content: "Hello" }, "claude"),
    ).toMatchObject([{ kind: type, text: "Hello", key: `fragment:${type}:0` }]);
    expect(parseClaudeEvent({ ...message, isMeta: true }, "claude")).toEqual([]);
  },
);

it.each(["Continue from where you left off.", "No response requested."])(
  "preserves literal conversation text: %s",
  (text) => {
    for (const type of ["user", "assistant"]) {
      const raw = { type, message: { model: "real-model", content: [{ type: "text", text }] } };
      expect(parseClaudeEvent(raw, "claude")).toContainEqual({ kind: type, text });
      expect(parseClaudeHistoryLine(JSON.stringify(raw), "claude")).toContainEqual({
        kind: type,
        text,
      });
    }
  },
);

it("hides resume metadata based on explicit provider markers", () => {
  for (const raw of [
    {
      type: "user",
      isMeta: true,
      message: { content: [{ type: "text", text: "Injected instruction" }] },
    },
    {
      type: "assistant",
      message: {
        model: "<synthetic>",
        content: [{ type: "text", text: "Synthetic acknowledgement" }],
      },
    },
  ]) {
    expect(parseClaudeEvent(raw, "claude")).toEqual([]);
    expect(parseClaudeHistoryLine(JSON.stringify(raw), "claude")).toEqual([]);
  }
});
