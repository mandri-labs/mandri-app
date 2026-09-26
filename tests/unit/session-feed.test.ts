import { beforeEach, describe, expect, it } from "vitest";
import { loadFixture } from "@/daemon/fixtures/load";
import type { FixtureFile } from "@/daemon/fixtures/load";
import { FixtureReplayer, validateFixtureFrames } from "@/daemon/fixtures/replay";
import { DaemonError } from "@/daemon/errors";
import type { EventMessage, HarnessKind, ServerMessage, WsTopic } from "@/daemon/types/ws";
import { HISTORY_PAGE_LIMIT, SessionFeedService, sessionFeed } from "@/daemon/ws/sessionFeed";
import type { HistoryPage } from "@/daemon/ws/sessionFeed";
import { dispatchFrame } from "@/app/framePipeline";
import { parseFrame } from "@/features/transcript/parse";
import type { TranscriptNode } from "@/features/transcript/parse";
import { transcriptStore } from "@/stores/sessions";

const SCENARIO = "tools-diff";

type HistoryCall = { sessionId: string; cursor: string | null; limit: number };

function createHistoryFetcher(pages: HistoryPage[]): { calls: HistoryCall[]; fetch: ReturnType<typeof makeFetcher> } {
  const calls: HistoryCall[] = [];
  return { calls, fetch: makeFetcher(pages, calls) };
}

function makeFetcher(pages: HistoryPage[], calls: HistoryCall[]) {
  return async (sessionId: string, cursor: string | null, limit: number): Promise<HistoryPage> => {
    calls.push({ sessionId, cursor, limit });
    if (pages.length === 0) {
      return { entries: [], next_cursor: null, has_more: false };
    }
    return pages.shift() as HistoryPage;
  };
}

function makeService(pages: HistoryPage[] = []): { service: SessionFeedService; calls: HistoryCall[] } {
  const { calls, fetch } = createHistoryFetcher(pages);
  return { service: new SessionFeedService({ fetchHistoryPage: fetch }), calls };
}

function fixtureSessionId(frames: readonly ServerMessage[]): string {
  for (const frame of frames) {
    if ("topic" in frame && frame.topic.startsWith("session.")) {
      return frame.topic.slice("session.".length);
    }
  }
  throw new Error("fixture has no session-topic frames");
}

async function loadToolsDiff(harness: HarnessKind): Promise<FixtureFile> {
  const fixture = await loadFixture(harness, SCENARIO);
  if (fixture === null) {
    throw new Error(`missing fixture: ${harness}/${SCENARIO}`);
  }
  return fixture;
}

async function replayFixture(
  service: SessionFeedService,
  fixture: FixtureFile,
  sessionId: string,
): Promise<void> {
  const replayer = new FixtureReplayer((frame) => {
    service.ingestSessionFrame(sessionId, fixture.harness, frame);
  });
  await replayer.replay(fixture, { speed: "instant" });
}

function eventFrames(fixture: FixtureFile): EventMessage[] {
  return validateFixtureFrames(fixture).frames.filter(
    (frame): frame is EventMessage => !("type" in frame) && "raw" in frame && "seq" in frame,
  );
}

function summarize(node: TranscriptNode): Record<string, unknown> {
  switch (node.kind) {
    case "user":
      return { kind: node.kind, text: node.text };
    case "assistant":
      return { kind: node.kind, text: node.text, streaming: node.streaming === true };
    case "thinking":
      return { kind: node.kind, text: node.text, streaming: node.streaming === true };
    case "tool": {
      const summary: Record<string, unknown> = {
        kind: node.kind,
        tool: node.tool,
        label: node.label,
        target: node.target,
        status: node.status,
      };
      if (node.durationMs !== undefined) {
        summary.durationMs = node.durationMs;
      }
      return summary;
    }
    case "diff":
      return {
        kind: node.kind,
        path: node.path,
        additions: node.additions,
        deletions: node.deletions,
        lineCount: node.lines?.length,
      };
    case "plan":
      return { kind: node.kind, steps: node.steps };
    case "system":
      return { kind: node.kind, level: node.level, text: node.text };
    case "raw":
      return { kind: node.kind, harness: node.harness, payload: rawSummary(node.payload) };
  }
  throw new Error(`unknown node kind: ${JSON.stringify(node)}`);
}

function rawSummary(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return `scalar:${String(payload)}`;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record["type"] === "string") {
    return `type:${record["type"]}`;
  }
  if (typeof record["method"] === "string") {
    return `method:${record["method"]}`;
  }
  return "object";
}

function serialized(nodes: readonly TranscriptNode[]): string {
  return JSON.stringify(nodes.map(summarize));
}

function nodesOf(service: SessionFeedService, sessionId: string): readonly TranscriptNode[] {
  return service.getNodes(sessionId);
}

function flagsOf(service: SessionFeedService, sessionId: string) {
  return service.getFlags(sessionId);
}

const CODEX_PROMPT =
  "In the current working directory create calc.ts exporting a function add(a: number, b: number): number, and calc.test.ts with three plain assertion checks of add. Run the test file with node --experimental-strip-types calc.test.ts. Then refactor add into a new function sum, keep add as a thin wrapper, and rerun the test file. Work only inside the current directory.";

const CLAUDE_EXPECTED = [
  { kind: "system", level: "warning", text: "API retry 1/10 (429): rate_limit" },
  { kind: "thinking", text: "Simple task. Create two files, run test, refactor, rerun.", streaming: false },
  { kind: "assistant", text: "Create both files.", streaming: false },
  { kind: "tool", tool: "Write", label: "Write", target: "__CWD__\\claude\\tools-diff\\calc.ts", status: "done" },
  { kind: "tool", tool: "Write", label: "Write", target: "__CWD__\\claude\\tools-diff\\calc.test.ts", status: "done" },
  { kind: "system", level: "warning", text: "API retry 1/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 2/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 3/10 (429): rate_limit" },
  {
    kind: "tool",
    tool: "Bash",
    label: "Bash",
    target: 'cd "__CWD__\\claude\\tools-diff" && node --experimental-strip-types calc.test.ts',
    status: "done",
  },
  { kind: "system", level: "warning", text: "API retry 1/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 2/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 3/10 (429): rate_limit" },
  {
    kind: "assistant",
    text: "Tests pass. Now refactor — `sum` new function, `add` thin wrapper.",
    streaming: false,
  },
  { kind: "tool", tool: "Write", label: "Write", target: "__CWD__\\claude\\tools-diff\\calc.ts", status: "done" },
  {
    kind: "tool",
    tool: "Bash",
    label: "Bash",
    target: 'cd "__CWD__\\claude\\tools-diff" && node --experimental-strip-types calc.test.ts',
    status: "done",
  },
  { kind: "system", level: "warning", text: "API retry 1/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 2/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 3/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 4/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 5/10 (unknown): unknown" },
  { kind: "system", level: "warning", text: "API retry 6/10 (429): rate_limit" },
  { kind: "system", level: "warning", text: "API retry 7/10 (429): rate_limit" },
];

const CODEX_EXPECTED = [
  {
    kind: "system",
    level: "warning",
    text: "Configured service tier `priority` is not advertised as supported for model `openrouter/z-ai/glm-5.2:free` and will be omitted from requests.",
  },
  {
    kind: "system",
    level: "warning",
    text: "Model metadata for `openrouter/z-ai/glm-5.2:free` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
  },
  { kind: "user", text: CODEX_PROMPT },
  {
    kind: "system",
    level: "error",
    text: "Codex error: exceeded retry limit, last status: 429 Too Many Requests",
  },
  {
    kind: "system",
    level: "error",
    text: "Turn failed: exceeded retry limit, last status: 429 Too Many Requests",
  },
];

const OPENCODE_REASONING =
  "User wants:\n1. Create calc.ts with add function\n2. Create calc.test.ts with three plain assertion checks\n3. Run with node --experimental-strip-types\n4. Refactor add into sum, keep add as wrapper\n5. Rerun tests\n\nSimple task. Working dir: __CWD__\\opencode\\tools-diff\n\nLet me create files. \"Plain assertion checks\" — use node:assert. Test file needs to run under node --experimental-strip-types, so TypeScript only, no imports from packages.\n\nLet me check node version maybe. --experimental-strip-types requires Node 22.6+. Let me just try.\n\nCreate calc.ts:\n```ts\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n```\n\ncalc.test.ts:\n```ts\nimport assert from \"node:assert\";\nimport { add } from \"./calc.ts\";\n\nassert.strictEqual(add(1, 2), 3);\nassert.strictEqual(add(-1, 1), 0);\nassert.strictEqual(add(0, 0), 0);\nconsole.log(\"all tests passed\");\n```\n\nNote: --experimental-strip-types requires explicit file extension in imports — \"./calc.ts\" works (actually with type stripping, importing \"./calc.ts\" is correct; \"./calc\" would fail).\n\nThen refactor:\n```ts\nexport function sum(a: number, b: number): number {\n  return a + b;\n}\n\nexport function add(a: number, b: number): number {\n  return sum(a, b);\n}\n```\n\nRerun tests.\n\nCaveman mode active but code normal. Keep responses terse.";

const OPENCODE_EXPECTED = [
  { kind: "user", text: CODEX_PROMPT },
  { kind: "thinking", text: OPENCODE_REASONING, streaming: false },
  {
    kind: "tool",
    tool: "write",
    label: "write",
    target: "__CWD__\\opencode\\tools-diff\\calc.ts",
    status: "done",
    durationMs: 19,
  },
  {
    kind: "tool",
    tool: "write",
    label: "write",
    target: "__CWD__\\opencode\\tools-diff\\calc.test.ts",
    status: "done",
    durationMs: 8,
  },
  {
    kind: "tool",
    tool: "bash",
    label: "bash",
    target: "node --experimental-strip-types calc.test.ts",
    status: "done",
    durationMs: 451,
  },
  { kind: "thinking", text: "Tests pass. Refactor now.", streaming: false },
  { kind: "assistant", text: "Tests pass. Refactoring:", streaming: false },
  {
    kind: "tool",
    tool: "edit",
    label: "edit",
    target: "__CWD__\\opencode\\tools-diff\\calc.ts",
    status: "done",
    durationMs: 15,
  },
  {
    kind: "diff",
    path: "__CWD__\\opencode\\tools-diff\\calc.ts",
    additions: 5,
    deletions: 1,
    lineCount: 8,
  },
];

describe("session feed ingestion (fixture replay)", () => {
  let service: SessionFeedService;
  let calls: HistoryCall[];

  beforeEach(() => {
    transcriptStore.getState().resetTranscripts();
    const made = makeService();
    service = made.service;
    calls = made.calls;
  });

  it("builds ordered transcript nodes for the claude tools-diff fixture", async () => {
    const fixture = await loadToolsDiff("claude");
    const frames = validateFixtureFrames(fixture).frames;
    const sessionId = fixtureSessionId(frames);
    service.ensureSession(sessionId, "claude");
    await replayFixture(service, fixture, sessionId);
    const nodes = nodesOf(service, sessionId);
    expect(nodes.filter((node) => node.kind === "diff")).toHaveLength(3);
    expect(serialized(nodes.filter((node) => node.kind !== "diff"))).toBe(JSON.stringify(CLAUDE_EXPECTED));
    const toolNodes = nodes.filter((node) => node.kind === "tool");
    expect(toolNodes.every((node) => node.status === "done")).toBe(true);
    expect(toolNodes.length).toBe(5);
  });

  it("builds ordered transcript nodes for the codex tools-diff fixture", async () => {
    const fixture = await loadToolsDiff("codex");
    const frames = validateFixtureFrames(fixture).frames;
    const sessionId = fixtureSessionId(frames);
    service.ensureSession(sessionId, "codex");
    await replayFixture(service, fixture, sessionId);
    const nodes = nodesOf(service, sessionId);
    expect(serialized(nodes)).toBe(JSON.stringify(CODEX_EXPECTED));
  });

  it("builds ordered transcript nodes for the opencode tools-diff fixture", async () => {
    const fixture = await loadToolsDiff("opencode");
    const frames = validateFixtureFrames(fixture).frames;
    const sessionId = fixtureSessionId(frames);
    service.ensureSession(sessionId, "opencode");
    await replayFixture(service, fixture, sessionId);
    const nodes = nodesOf(service, sessionId);
    expect(nodes.filter((node) => node.kind === "file_snapshot")).toMatchObject([{ scope: "session", files: [] }]);
    expect(nodes.filter((node) => node.kind === "raw").every((node) =>
      ["step-start", "step-finish"].includes((node.payload as { type: string }).type))).toBe(true);
    expect(serialized(nodes.filter((node) => node.kind !== "file_snapshot" && node.kind !== "raw"))).toBe(JSON.stringify(OPENCODE_EXPECTED));
  });

  it("keeps buffers isolated per session", async () => {
    const fixture = await loadToolsDiff("codex");
    const frames = validateFixtureFrames(fixture).frames;
    service.ensureSession("buffer-a", "codex");
    service.ensureSession("buffer-b", "codex");
    const replayer = new FixtureReplayer((frame) => {
      service.ingestSessionFrame("buffer-a", "codex", frame);
    });
    await replayer.replay(fixture, { speed: "instant" });
    const nodesA = nodesOf(service, "buffer-a");
    const nodesB = nodesOf(service, "buffer-b");
    expect(nodesA.length).toBe(CODEX_EXPECTED.length);
    expect(nodesB.length).toBe(0);
    expect(nodesA).not.toBe(nodesB);
    service.ingestSessionFrame("buffer-b", "codex", frames[1] as ServerMessage);
    expect(nodesOf(service, "buffer-a").length).toBe(CODEX_EXPECTED.length);
  });

  it("drops duplicate sequence numbers", async () => {
    const fixture = await loadToolsDiff("codex");
    const events = eventFrames(fixture);
    const sessionId = fixtureSessionId(validateFixtureFrames(fixture).frames);
    service.ensureSession(sessionId, "codex");
    service.ingestSessionFrame(sessionId, "codex", events[0] as ServerMessage);
    const count = nodesOf(service, sessionId).length;
    service.ingestSessionFrame(sessionId, "codex", events[0] as ServerMessage);
    expect(nodesOf(service, sessionId).length).toBe(count);
  });

  it("flags a gap on a sequence hole and refetches the history tail", async () => {
    const fixture = await loadToolsDiff("codex");
    const events = eventFrames(fixture);
    const sessionId = fixtureSessionId(validateFixtureFrames(fixture).frames);
    service.ensureSession(sessionId, "codex");
    for (const event of events.slice(0, 6)) {
      service.ingestSessionFrame(sessionId, "codex", event);
    }
    const holedSource = events[6];
    if (holedSource === undefined) {
      throw new Error("fixture too small for gap test");
    }
    const holed: EventMessage = { ...holedSource, seq: holedSource.seq + 3 };
    service.ingestSessionFrame(sessionId, "codex", holed);
    expect(flagsOf(service, sessionId).gapFlag).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ sessionId, cursor: null, limit: HISTORY_PAGE_LIMIT }]);
    expect(flagsOf(service, sessionId).gapFlag).toBe(false);
  });

  it("merges fixture history before live nodes and respects the cursor", async () => {
    const fixture = await loadToolsDiff("claude");
    const pages: HistoryPage[] = [
      { entries: fixture.history.entries, next_cursor: "cursor-2", has_more: true },
      { entries: [], next_cursor: null, has_more: false },
    ];
    const made = makeService(pages);
    const historyService = made.service;
    const historyCalls = made.calls;
    const sessionId = "history-session";
    historyService.ensureSession(sessionId, "claude");
    await historyService.loadHistory(sessionId);
    expect(historyCalls[0]).toEqual({ sessionId, cursor: null, limit: HISTORY_PAGE_LIMIT });
    await historyService.loadHistory(sessionId);
    expect(historyCalls[1]?.cursor).toBe("cursor-2");
    const beforeLive = nodesOf(historyService, sessionId).length;
    expect(beforeLive).toBeGreaterThan(0);
    expect(nodesOf(historyService, sessionId)[0]?.kind).toBe("user");
    const replayer = new FixtureReplayer((frame) => {
      historyService.ingestSessionFrame(sessionId, "claude", frame);
    });
    const liveFixture = await loadToolsDiff("claude");
    await replayer.replay(liveFixture, { speed: "instant", maxFrames: 12 });
    const nodes = nodesOf(historyService, sessionId);
    expect(nodes.length).toBeGreaterThan(beforeLive);
    expect(nodes[0]?.kind).toBe("user");
    expect(nodes.at(-1)?.kind).not.toBe("undefined");
    const firstLiveIndex = nodes.findIndex((node) => node.kind === "assistant" && node.text === "Create both files.");
    expect(firstLiveIndex).toBeGreaterThan(0);
    expect(nodes.slice(0, beforeLive).some((node) => node.kind === "raw")).toBe(true);
  });

  it("marks history unavailable and appends a system node when history fetch fails", async () => {
    const failing = new SessionFeedService({
      fetchHistoryPage: async () => {
        throw new DaemonError({ code: "history_cursor_invalid", message: "bad cursor" });
      },
    });
    const sessionId = "failing-history";
    failing.ensureSession(sessionId, "claude");
    await failing.loadHistory(sessionId);
    const flags = flagsOf(failing, sessionId);
    expect(flags.historyUnavailable).toBe(true);
    const nodes = nodesOf(failing, sessionId);
    const systemNodes = nodes.filter((node) => node.kind === "system");
    expect(systemNodes.some((node) => node.level === "error")).toBe(true);
  });

  it("appends a warning node for degradation frames and an error node for control_lost", async () => {
    const sessionId = "degraded-session";
    service.ensureSession(sessionId, "opencode");
    const degradation: EventMessage = {
      topic: `session.${sessionId}` as WsTopic,
      seq: 1,
      source: "mandri",
      raw: { error: "oversize", size: 4096 },
      ts: 0,
    };
    service.ingestSessionFrame(sessionId, "opencode", degradation);
    const controlLost: ServerMessage = {
      type: "control_lost",
      topic: `session.${sessionId}` as WsTopic,
      seq: 2,
      source: "mandri",
      raw: { session_id: sessionId, harness: "opencode" },
      ts: 0,
    };
    service.ingestSessionFrame(sessionId, "opencode", controlLost);
    const nodes = nodesOf(service, sessionId);
    expect(nodes[0]).toMatchObject({ kind: "system", level: "warning" });
    expect(nodes[1]).toMatchObject({ kind: "system", level: "error" });
  });

  it("parses unknown opencode event shapes into raw nodes instead of dropping them", () => {
    const nodes = parseFrame("opencode", {
      id: "evt_unknown",
      type: "brand.new.event",
      properties: { detail: "x" },
    });
    expect(nodes.length).toBe(1);
    expect(nodes[0]).toMatchObject({ kind: "raw", harness: "opencode" });
  });

  it("routes session-topic frames from the frame pipeline into the session feed", () => {
    dispatchFrame({
      topic: "session.wired-session" as WsTopic,
      seq: 1,
      source: "claude",
      raw: {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "pipewired" }] },
      },
      ts: 0,
    });
    const nodes = sessionFeed.getNodes("wired-session");
    expect(nodes.some((node) => node.kind === "assistant" && node.text === "pipewired")).toBe(
      true,
    );
    sessionFeed.closeSession("wired-session");
  });
});
