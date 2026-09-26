import { describe, expect, it } from "vitest";
import { parseClaudeEvent } from "@/features/transcript/parse/claude";
import { presentTranscript } from "@/features/transcript/presentation";

describe("native command notices", () => {
  it("shows top-level conversation resets without technical events", () => {
    const nodes = parseClaudeEvent({ type: "conversation_reset", new_conversation_id: "new", session_id: "old" }, "claude");
    expect(nodes).toMatchObject([{ kind: "system", messageKey: "commands.conversation_reset" }]);
    expect(presentTranscript(nodes, false)).toHaveLength(1);
  });
  it("shows native compaction completion", () => {
    expect(parseClaudeEvent({ type: "system", subtype: "compact_boundary", uuid: "c" }, "claude"))
      .toMatchObject([{ kind: "system", messageKey: "commands.compacted" }]);
  });
});
