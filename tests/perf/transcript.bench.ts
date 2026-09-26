import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n";
import type {
  TranscriptDiffLine,
  TranscriptNode,
  TranscriptPlanStep,
} from "@/features/transcript/parse/types";
import { Transcript } from "@/features/transcript/Transcript";
import { transcriptStore } from "@/stores/sessions";

const SESSION_ID = "bench-session";
const INITIAL_COUNT = 12000;
const APPEND_BATCHES = 20;
const APPEND_PER_BATCH = 10;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;
const AVG_BUDGET_MS = 50;
const ASSISTANT_CHARS_PER_ROW = 48;
const ASSISTANT_BASE_PX = 20;
const ASSISTANT_MIN_PX = 20;
const ASSISTANT_MAX_PX = 400;

const originalRect = Element.prototype.getBoundingClientRect;
const originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

function patchMetrics(): void {
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      if (this.classList.contains("transcript-viewport")) {
        const inner = this.querySelector<HTMLElement>(".transcript-inner");
        const height = inner?.style.height;
        return height === undefined || height.length === 0 ? 0 : Number.parseFloat(height);
      }
      return originalScrollHeight?.get?.call(this) ?? 0;
    },
  });
  for (const [proto, prop, value] of [
    [HTMLElement.prototype, "clientHeight", VIEWPORT_HEIGHT],
    [HTMLElement.prototype, "offsetHeight", VIEWPORT_HEIGHT],
    [HTMLElement.prototype, "offsetWidth", VIEWPORT_WIDTH],
  ] as const) {
    Object.defineProperty(proto, prop, {
      configurable: true,
      get(this: Element) {
        if (this.classList.contains("transcript-viewport")) {
          return value;
        }
        if (prop === "offsetHeight" && this.classList.contains("transcript-item")) {
          return estimatedRectHeight(this);
        }
        const original =
          prop === "clientHeight"
            ? originalClientHeight
            : prop === "offsetHeight"
              ? originalOffsetHeight
              : originalOffsetWidth;
        return original?.get?.call(this) ?? 0;
      },
    });
  }
}

function makeRect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function patchedRect(this: Element): DOMRect {
  if (this.classList.contains("transcript-viewport")) {
    return makeRect(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  }
  return makeRect(VIEWPORT_WIDTH, estimatedRectHeight(this));
}

function estimatedRectHeight(element: Element): number {
  if (element.querySelector(".tr-user-bubble") !== null) {
    return 44;
  }
  if (element.querySelector(".tr-thinking") !== null) {
    return 28;
  }
  if (element.querySelector(".tr-tool") !== null) {
    return 32;
  }
  if (element.querySelector(".tr-diff") !== null) {
    return 120;
  }
  if (element.querySelector(".tr-plan") !== null) {
    return 80;
  }
  if (element.querySelector(".tr-banner") !== null) {
    return 36;
  }
  if (element.querySelector(".tr-raw") !== null) {
    return 32;
  }
  const text = element.textContent ?? "";
  const estimated = text.length / ASSISTANT_CHARS_PER_ROW + ASSISTANT_BASE_PX;
  return Math.round(Math.min(ASSISTANT_MAX_PX, Math.max(ASSISTANT_MIN_PX, estimated)));
}

function makeDiffLines(seed: number): TranscriptDiffLine[] {
  const lines: TranscriptDiffLine[] = [];
  for (let line = 0; line < 12; line += 1) {
    lines.push({
      type: line % 3 === 0 ? "add" : line % 3 === 1 ? "del" : "context",
      text: `const value_${seed}_${line} = compute(${line});`,
      oldNo: 100 + line,
      newNo: 100 + line,
    });
  }
  return lines;
}

function makePlanSteps(seed: number): TranscriptPlanStep[] {
  return [0, 1, 2, 3].map((step) => ({
    text: `Step ${seed}.${step}: investigate and verify`,
    status: step === 1 ? "running" : step < 1 ? "done" : "waiting",
  }));
}

function makeAssistantText(seed: number): string {
  return `Assistant explanation ${seed}: refactor the module, verify the result, and report back. `.repeat(
    3 + (seed % 8),
  );
}

function makeNodes(count: number): TranscriptNode[] {
  const nodes: TranscriptNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const slot = i % 20;
    if (slot < 1) {
      nodes.push({ kind: "user", text: "Please continue with the plan", key: `bench-${i}` });
    } else if (slot < 6) {
      nodes.push({ kind: "assistant", text: makeAssistantText(i), key: `bench-${i}` });
    } else if (slot < 8) {
      nodes.push({ kind: "thinking", text: "Considering the next step", key: `bench-${i}` });
    } else if (slot < 14) {
      nodes.push({
        kind: "tool",
        tool: "Bash",
        label: "Bash",
        target: "npm test",
        status: "done",
        durationMs: 1200 + (i % 5) * 100,
        key: `bench-${i}`,
      });
    } else if (slot < 17) {
      nodes.push({
        kind: "diff",
        path: `src/module-${i}.ts`,
        additions: i % 40,
        deletions: i % 7,
        lines: makeDiffLines(i),
        key: `bench-${i}`,
      });
    } else if (slot < 18) {
      nodes.push({ kind: "plan", steps: makePlanSteps(i), key: `bench-${i}` });
    } else if (slot < 19) {
      nodes.push({ kind: "system", level: "info", text: "Session heartbeat" });
    } else {
      nodes.push({ kind: "raw", harness: "claude", payload: { type: "raw.event", i } });
    }
  }
  return nodes;
}

function makeAppendBatch(batch: number): TranscriptNode[] {
  const nodes: TranscriptNode[] = [];
  for (let i = 0; i < APPEND_PER_BATCH; i += 1) {
    const index = batch * APPEND_PER_BATCH + i;
    nodes.push({
      kind: "assistant",
      text: `Streaming update ${index}: the agent keeps producing visible output. `,
      streaming: true,
      key: `append-${index}`,
    });
  }
  return nodes;
}

function renderTranscript(): HTMLElement {
  const { container } = render(
    createElement(Transcript, { sessionId: SESSION_ID, harness: "claude" }),
  );
  const viewport = container.querySelector<HTMLElement>(".transcript-viewport");
  if (viewport === null) {
    throw new Error("transcript viewport missing");
  }
  return viewport;
}

function dispatchScroll(viewport: HTMLElement): void {
  viewport.dispatchEvent(new Event("scroll"));
}

function currentNodes(): readonly TranscriptNode[] {
  return transcriptStore.getState().transcripts[SESSION_ID]?.nodes ?? [];
}

describe("transcript virtualization benchmark", () => {
  beforeAll(async () => {
    Element.prototype.getBoundingClientRect = patchedRect;
    patchMetrics();
    await initI18n("en");
  });

  afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    if (originalScrollHeight !== undefined) {
      Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
    }
    if (originalClientHeight !== undefined) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    }
    if (originalOffsetHeight !== undefined) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
    if (originalOffsetWidth !== undefined) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    }
  });

  afterEach(() => {
    cleanup();
    transcriptStore.getState().resetTranscripts();
  });

  it("keeps streaming appends under budget and anchored to the end", async () => {
    transcriptStore.getState().setNodes(SESSION_ID, makeNodes(INITIAL_COUNT));
    const viewport = renderTranscript();
    await act(async () => {
      await Promise.resolve();
      dispatchScroll(viewport);
    });
    expect(viewport.scrollTop).toBeGreaterThan(0);

    const samples: number[] = [];
    for (let batch = 0; batch < APPEND_BATCHES; batch += 1) {
      const appended = makeAppendBatch(batch);
      const started = performance.now();
      act(() => {
        transcriptStore
          .getState()
          .setNodes(SESSION_ID, [...currentNodes(), ...appended]);
      });
      act(() => {
        dispatchScroll(viewport);
      });
      samples.push(performance.now() - started);
      const lastMarker = batch * APPEND_PER_BATCH + APPEND_PER_BATCH - 1;
      expect(viewport.textContent ?? "").toContain(`Streaming update ${lastMarker}`);
    }

    const total = samples.reduce((sum, ms) => sum + ms, 0);
    const average = total / samples.length;
    const worst = Math.max(...samples);
    console.table(
      samples.map((ms, batch) => ({
        batch: batch + 1,
        appended: APPEND_PER_BATCH,
        ms: Number(ms.toFixed(2)),
      })),
    );
    console.log(
      `transcript bench: nodes=${INITIAL_COUNT} batches=${APPEND_BATCHES}x${APPEND_PER_BATCH} avg=${average.toFixed(2)}ms worst=${worst.toFixed(2)}ms budget=${AVG_BUDGET_MS}ms`,
    );
    expect(average).toBeLessThan(AVG_BUDGET_MS);
    expect(viewport.scrollTop).toBeGreaterThan(0);
  });
});
