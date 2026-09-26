import { describe, expect, it } from "vitest";
import { codexOutputText } from "@/features/transcript/parse/codexOutput";
import { parseCodexEvent, parseCodexHistoryLine } from "@/features/transcript/parse/codex";

describe("Codex output presentation", () => {
  it("omits successful turn markers but retains turn errors", () => {
    expect(parseCodexEvent({ method: "turn/completed", params: { turn: { status: "completed" } } }, "codex")).toEqual([]);
    expect(parseCodexEvent({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "Failure" } } } }, "codex"))
      .toEqual([{ kind: "system", level: "error", text: "Turn failed: Failure" }]);
  });
  it("decodes exec output without destroying Windows paths or literal escapes", () => {
    const output = 'C:\\new\\test.ts\r\nconst pattern = "\\n";\r\nsecond line';
    const result = codexOutputText(
      `Script completed\nWall time 1.7 seconds\nOutput:\n\n${JSON.stringify({ exit_code: 0, output })}`,
    );
    expect(result).toContain("C:\\new\\test.ts");
    expect(result).toContain('const pattern = "\\n";');
    expect(result).toContain("\n  second line");
    expect(result).not.toContain("\\r\\n");
    expect(result).toContain("exit_code: 0");
  });

  it("formats multiple exec results and preserves ordinary text", () => {
    const result = codexOutputText(
      "Script completed\nOutput:\n" +
        JSON.stringify({ output: "first\nline" }) +
        "\nintermediate text\n" +
        JSON.stringify({ output: "second\nline" }),
    );
    expect(result).toContain("first\n  line");
    expect(result).toContain("intermediate text");
    expect(result).toContain("second\n  line");
    const plain = 'partial {"output":"broken\\n\nC:\\new\\test';
    expect(codexOutputText(plain)).toBe(plain);
  });

  it("presents answers and agent results as readable fields", () => {
    expect(
      codexOutputText(
        JSON.stringify({ answers: { policy: { answers: ["Keep active", "Other\nanswer"] } } }),
      ),
    ).toBe("answers:\n  policy:\n    answers:\n      Keep active\n      Other\n      answer");
    expect(codexOutputText('{"task_name":"/root/test"}')).toBe("task_name: /root/test");
  });

  it("normalizes history results and live command output, retaining failures and identities", () => {
    const output = JSON.stringify({ exit_code: 1, output: "first\nsecond" });
    const history = parseCodexHistoryLine(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output,
        },
      }),
      "codex",
    );
    expect(history[0]).toMatchObject({
      key: "call-1",
      status: "failed",
      detailText: "exit_code: 1\noutput:\n  first\n  second",
    });
    const live = parseCodexEvent(
      {
        method: "item/completed",
        params: {
          item: {
            type: "commandExecution",
            id: "call-1",
            exitCode: 1,
            aggregatedOutput: output,
          },
        },
      },
      "codex",
    );
    expect(live[0]).toMatchObject({
      key: "call-1",
      status: "failed",
      detailText: history[0]?.kind === "tool" ? history[0].detailText : undefined,
    });
  });
});
