import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PaneManager } from "@/app/panes/PaneManager";
import { initI18n } from "@/i18n";
import type {
  TranscriptDiffLine,
  TranscriptNode,
  TranscriptPlanStep,
} from "@/features/transcript/parse/types";
import { panesStore } from "@/stores/panes";
import { sessionsStore, transcriptStore } from "@/stores/sessions";

const PANE_COUNT = 4;
const SEED_COUNT = 2000;
const APPENDS_PER_PANE = 400;
const TOTAL_APPENDS = PANE_COUNT * APPENDS_PER_PANE;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;
const AVG_BUDGET_MS = 50;
const ANCHOR_TOLERANCE_PX = 2;
const ASSISTANT_CHARS_PER_ROW = 48;
const ASSISTANT_BASE_PX = 20;
const ASSISTANT_MIN_PX = 20;
const ASSISTANT_MAX_PX = 400;
const APPROX_NODE_BYTES = 512;
const TEST_TIMEOUT_MS = 600000;

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

const SESSION_IDS = ["pane-bench-0", "pane-bench-1", "pane-bench-2", "pane-bench-3"];

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
      text: `const diff_${seed}_${line} = compute(${line});`,
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

function makeSeedNodes(sessionIndex: number, count: number): TranscriptNode[] {
  const nodes: TranscriptNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const key = `p${sessionIndex}-seed-${i}`;
    const slot = i % 20;
    if (slot < 1) {
      nodes.push({ kind: "user", text: "Please continue with the plan", key });
    } else if (slot < 6) {
      nodes.push({ kind: "assistant", text: makeAssistantText(i), key });
    } else if (slot < 8) {
      nodes.push({ kind: "thinking", text: "Considering the next step", key });
    } else if (slot < 14) {
      nodes.push({
        kind: "tool",
        tool: "Bash",
        label: "Bash",
        target: "npm test",
        status: "done",
        durationMs: 1200 + (i % 5) * 100,
        key,
      });
    } else if (slot < 17) {
      nodes.push({
        kind: "diff",
        path: `src/module-${i}.ts`,
        additions: i % 40,
        deletions: i % 7,
        lines: makeDiffLines(i),
        key,
      });
    } else if (slot < 18) {
      nodes.push({ kind: "plan", steps: makePlanSteps(i), key });
    } else if (slot < 19) {
      nodes.push({ kind: "system", level: "info", text: "Session heartbeat" });
    } else {
      nodes.push({ kind: "raw", harness: "claude", payload: { type: "raw.event", i } });
    }
  }
  return nodes;
}

function makeAppendNode(sessionIndex: number, appendIndex: number): TranscriptNode {
  return {
    kind: "assistant",
    text: `Pane append ${sessionIndex}:${appendIndex}: the agent keeps producing visible output. `,
    streaming: true,
    key: `p${sessionIndex}-append-${appendIndex}`,
  };
}

function seedSessionsAndPanes(): void {
  sessionsStore.getState().upsertFromRest(
    SESSION_IDS.map((id, index) => ({
      id,
      harness: "claude",
      native_id: null,
      title: `Bench session ${index}`,
      project_path: "D:/Dev/bench",
      created_at: 1,
      updated_at: 2,
      state: "live",
      model: "bench/model",
      activity: "active",
      last_activity_at: 100 + index,
    })),
  );
  for (const [index, id] of SESSION_IDS.entries()) {
    transcriptStore.getState().setNodes(id, makeSeedNodes(index, SEED_COUNT));
    const opened = panesStore.getState().openPane(id);
    if (!opened) {
      throw new Error(`pane open rejected for ${id}`);
    }
  }
}

function renderPaneGrid(): HTMLElement {
  const { container } = render(createElement(PaneManager));
  const viewports = container.querySelectorAll<HTMLElement>(".transcript-viewport");
  if (viewports.length !== PANE_COUNT) {
    throw new Error(`expected ${PANE_COUNT} viewports, found ${viewports.length}`);
  }
  return container;
}

function viewportsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".transcript-viewport"));
}

function bottomOffset(viewport: HTMLElement): number {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

function dispatchScroll(viewport: HTMLElement): void {
  viewport.dispatchEvent(new Event("scroll"));
}

function percentile(samples: number[], fraction: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

function sessionIdAt(paneIndex: number): string {
  const id = SESSION_IDS[paneIndex];
  if (id === undefined) {
    throw new Error(`no session for pane ${paneIndex}`);
  }
  return id;
}

function viewportAt(viewports: HTMLElement[], paneIndex: number): HTMLElement {
  const viewport = viewports[paneIndex];
  if (viewport === undefined) {
    throw new Error(`no viewport for pane ${paneIndex}`);
  }
  return viewport;
}

function nodesOf(sessionId: string): readonly TranscriptNode[] {
  return transcriptStore.getState().transcripts[sessionId]?.nodes ?? [];
}

describe("4-pane streaming benchmark", () => {
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
    panesStore.getState().closeAll();
    sessionsStore.getState().setFilters({});
    transcriptStore.getState().resetTranscripts();
    for (const id of SESSION_IDS) {
      sessionsStore.getState().markDeleted(id);
    }
  });

  it(
    "streams appends round-robin across 4 panes under budget and anchored",
    async () => {
      seedSessionsAndPanes();
      const container = renderPaneGrid();
      await act(async () => {
        await Promise.resolve();
        for (const viewport of viewportsOf(container)) {
          dispatchScroll(viewport);
        }
      });
      const viewports = viewportsOf(container);
      for (const viewport of viewports) {
        expect(viewport.scrollTop).toBeGreaterThan(0);
      }

      const appendCounts = [0, 0, 0, 0];
      const samples: number[] = [];
      const perPaneSamples: number[][] = [[], [], [], []];

      for (let round = 0; round < TOTAL_APPENDS; round += 1) {
        const paneIndex = round % PANE_COUNT;
        const sessionId = sessionIdAt(paneIndex);
        const current = [...nodesOf(sessionId)];
        const appendIndex = appendCounts[paneIndex] ?? 0;
        current.push(makeAppendNode(paneIndex, appendIndex));
        appendCounts[paneIndex] = appendIndex + 1;
        const paneViewport = viewportAt(viewports, paneIndex);
        const started = performance.now();
        act(() => {
          transcriptStore.getState().setNodes(sessionId, current);
          dispatchScroll(paneViewport);
        });
        const elapsed = performance.now() - started;
        samples.push(elapsed);
        const paneSamples = perPaneSamples[paneIndex];
        if (paneSamples === undefined) {
          throw new Error(`no sample bucket for pane ${paneIndex}`);
        }
        paneSamples.push(elapsed);

        if (round % 100 === 99) {
          for (const viewport of viewports) {
            expect(bottomOffset(viewport)).toBeLessThan(ANCHOR_TOLERANCE_PX);
          }
        }
      }

      const average = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
      const p95 = percentile(samples, 0.95);

      console.table(
        perPaneSamples.map((paneSamples, paneIndex) => ({
          pane: paneIndex,
          appends: paneSamples.length,
          avgMs: Number(
            (paneSamples.reduce((sum, ms) => sum + ms, 0) / paneSamples.length).toFixed(2),
          ),
          p95Ms: Number(percentile(paneSamples, 0.95).toFixed(2)),
        })),
      );
      console.log(
        `panes bench: panes=${PANE_COUNT} seed=${SEED_COUNT}/pane appends=${APPENDS_PER_PANE}/pane ` +
          `avg=${average.toFixed(2)}ms p95=${p95.toFixed(2)}ms budget=${AVG_BUDGET_MS}ms`,
      );

      for (const paneIndex of SESSION_IDS.keys()) {
        const viewport = viewportAt(viewports, paneIndex);
        expect(
          viewport.textContent ?? "",
        ).toContain(`Pane append ${paneIndex}:${APPENDS_PER_PANE - 1}`);
      }

      for (const viewport of viewports) {
        expect(bottomOffset(viewport)).toBeLessThan(ANCHOR_TOLERANCE_PX);
      }

      const memoryReport = SESSION_IDS.map((id, paneIndex) => {
        const count = nodesOf(id).length;
        return {
          pane: paneIndex,
          nodes: count,
          approxKb: Math.round((count * APPROX_NODE_BYTES) / 1024),
        };
      });
      const totalNodes = memoryReport.reduce((sum, row) => sum + row.nodes, 0);
      console.log(
        `panes memory heuristic: ${JSON.stringify(memoryReport)} totalNodes=${totalNodes} ` +
          `totalApproxKb=${Math.round((totalNodes * APPROX_NODE_BYTES) / 1024)} (estimate only, no assertion)`,
      );

      expect(average).toBeLessThan(AVG_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "renders reduced density when gap flag set on one pane",
    async () => {
      seedSessionsAndPanes();
      const container = renderPaneGrid();
      await act(async () => {
        await Promise.resolve();
        for (const viewport of viewportsOf(container)) {
          dispatchScroll(viewport);
        }
      });

      const gapSession = sessionIdAt(1);
      const before = viewportAt(viewportsOf(container), 1).textContent ?? "";
      expect(before).toContain("diff_1995_11");

      act(() => {
        transcriptStore.getState().setFlags(gapSession, { gapFlag: true });
      });

      const viewports = viewportsOf(container);
      expect(viewports.length).toBe(PANE_COUNT);
      const after = viewportAt(viewports, 1).textContent ?? "";
      expect(after).toContain("diff_1995_0");
      expect(after).not.toContain("diff_1995_11");
      for (const viewport of viewports) {
        expect((viewport.textContent ?? "").length).toBeGreaterThan(0);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
