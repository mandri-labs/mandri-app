import { describe, expect, it } from "vitest";
import { fuzzyMatch, rankModelRefs } from "@/lib/fuzzy";

describe("fuzzyMatch", () => {
  it("returns null for an empty query", () => {
    expect(fuzzyMatch("", "gpt-5")).toBeNull();
  });

  it("returns null when the query cannot be matched in order", () => {
    expect(fuzzyMatch("xz", "gpt-5")).toBeNull();
  });

  it("matches a plain substring with its indices", () => {
    const match = fuzzyMatch("gpt", "openai/gpt-5");
    expect(match).not.toBeNull();
    expect(match?.indices).toEqual([7, 8, 9]);
  });

  it("matches out-of-order subsequences case-insensitively", () => {
    const match = fuzzyMatch("g5", "openai/gpt-5");
    expect(match).not.toBeNull();
    expect(match?.indices).toEqual([7, 11]);
  });

  it("rewards word boundaries after separators", () => {
    const boundary = fuzzyMatch("g", "openai/gpt-5");
    const middle = fuzzyMatch("p", "openai/gpt-5");
    expect(boundary?.score ?? -Infinity).toBeGreaterThan(middle?.score ?? -Infinity);
  });

  it("rewards camelCase boundaries", () => {
    const camel = fuzzyMatch("v", "sonnetView");
    const plain = fuzzyMatch("w", "sonnetviEW");
    expect(camel?.score).toBeGreaterThan(plain?.score ?? -Infinity);
  });

  it("rewards consecutive matches over scattered ones", () => {
    const consecutive = fuzzyMatch("gpt", "gpt-5-turbo");
    const scattered = fuzzyMatch("gpt", "gxgpt");
    expect(consecutive?.score).toBeGreaterThan(scattered?.score ?? -Infinity);
  });
});

describe("rankModelRefs", () => {
  const ROWS = [
    { provider: "openai", modelId: "gpt-5" },
    { provider: "openai", modelId: "o4-mini" },
    { provider: "openrouter", modelId: "z-ai/glm-5.3-flash" },
    { provider: "anthropic", modelId: "claude-sonnet-4" },
  ];

  it("returns nothing for a blank query", () => {
    expect(rankModelRefs("   ", ROWS)).toEqual([]);
  });

  it("keeps only matching models", () => {
    const ranked = rankModelRefs("glm", ROWS);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.ref).toBe("openrouter/z-ai/glm-5.3-flash");
  });

  it("ranks exact model-name hits above provider-only hits", () => {
    const ranked = rankModelRefs("gpt", ROWS);
    expect(ranked[0]?.ref).toBe("openai/gpt-5");
  });

  it("matches by provider alone and keeps groups together", () => {
    const ranked = rankModelRefs("anthropic", ROWS);
    expect(ranked.map((row) => row.ref)).toEqual(["anthropic/claude-sonnet-4"]);
  });

  it("matches multi-segment provider paths", () => {
    const ranked = rankModelRefs("z-ai", ROWS);
    expect(ranked[0]?.ref).toBe("openrouter/z-ai/glm-5.3-flash");
  });

  it("breaks score ties alphabetically", () => {
    const ranked = rankModelRefs("o", [
      { provider: "bb", modelId: "o" },
      { provider: "aa", modelId: "o" },
    ]);
    expect(ranked.map((row) => row.ref)).toEqual(["aa/o", "bb/o"]);
  });
});
