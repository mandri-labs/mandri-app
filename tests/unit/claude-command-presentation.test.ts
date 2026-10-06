import { describe, expect, it } from "vitest";
import { parseClaudeEvent, parseClaudeHistoryLine } from "@/features/transcript/parse/claude";

function message(text: string, role = "user") {
  return { type: role, uuid: "command-event", message: { role, content: text } };
}

const goal =
  "<command-name>/goal</command-name>\n<command-message>goal</command-message>\n<command-args>Say hello</command-args>";

describe("Claude native command presentation", () => {
  it("renders the native envelope as a readable command in live events and history", () => {
    const event = message(goal);
    const live = parseClaudeEvent(event, "claude");
    expect(live).toEqual([{ kind: "user", text: "/goal Say hello", key: "command-event:user:0" }]);
    expect(parseClaudeHistoryLine(JSON.stringify(event), "claude")).toEqual(live);
  });

  it("supports arbitrary discovered names, multiline arguments, and the alternate native tag order", () => {
    const text =
      "<command-message>workspace-check</command-message>\n<command-name>/workspace-check</command-name>\n<command-args>Check auth\nand tests</command-args>";
    expect(parseClaudeEvent(message(text), "claude")[0]).toMatchObject({
      kind: "user",
      text: "/workspace-check Check auth\nand tests",
    });
    expect(
      parseClaudeEvent(message("<command-name>/custom</command-name>"), "claude")[0],
    ).toMatchObject({ text: "/custom" });
  });

  it.each(["stdout", "stderr"])("turns local-command-%s into a readable notice", (stream) => {
    expect(
      parseClaudeEvent(
        message(`<local-command-${stream}>Command response</local-command-${stream}>`),
        "claude",
      )[0],
    ).toMatchObject({
      kind: "system",
      text: "Command response",
      level: stream === "stderr" ? "error" : "info",
    });
  });

  it.each([
    `Please explain this: ${goal}`,
    `\`\`\`xml\n${goal}\n\`\`\``,
    "<command-name>/custom</command-name><unknown>keep me</unknown>",
  ])("preserves quoted, embedded and unrecognized content", (text) => {
    expect(parseClaudeEvent(message(text), "claude")[0]).toMatchObject({ kind: "user", text });
  });

  it("does not reinterpret assistant prose or expose hidden metadata", () => {
    expect(parseClaudeEvent(message(goal, "assistant"), "claude")[0]).toMatchObject({
      kind: "assistant",
      text: goal,
    });
    expect(parseClaudeEvent({ ...message(goal), isMeta: true }, "claude")).toEqual([]);
  });
});
