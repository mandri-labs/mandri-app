import type { HarnessKind, ServerMessage } from "../types/ws";
import { parseServerMessage } from "../ws/protocol";
import type { Clock } from "../ws/protocol";
import type { FixtureFile } from "./load";

const DEFAULT_YIELD_EVERY = 32;
const DEFAULT_TIME_SCALE = 1;

export interface FixtureReplayIssue {
  index: number;
  reason: string;
  frame: unknown;
}

export interface FixtureFrameBatch {
  frames: ServerMessage[];
  issues: FixtureReplayIssue[];
}

export type FixtureIngest = (frame: ServerMessage, fixture: FixtureFile) => void;

export interface FixtureReplayOptions {
  speed?: "instant" | "realtime";
  filter?: (frame: ServerMessage) => boolean;
  maxFrames?: number;
  timeScale?: number;
  maxDelayMs?: number;
  yieldEvery?: number;
}

export interface FixtureSessionSeed {
  id: string;
  harness: HarnessKind;
  state: "stopped" | "live";
  title: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function defaultClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeout: (handle) => clearTimeout(handle as number),
  };
}

export function validateFixtureFrames(fixture: FixtureFile): FixtureFrameBatch {
  const frames: ServerMessage[] = [];
  const issues: FixtureReplayIssue[] = [];
  fixture.frames.forEach((entry, index) => {
    const parsed = parseServerMessage(entry.frame);
    if (parsed === null) {
      issues.push({ index, reason: "invalid_frame", frame: entry.frame });
      return;
    }
    frames.push(parsed);
  });
  return { frames, issues };
}

export function replayHistory(fixture: FixtureFile): string[] {
  return [...fixture.history.entries];
}

function selectFrames(frames: ServerMessage[], options: FixtureReplayOptions): ServerMessage[] {
  const filtered = options.filter === undefined ? frames : frames.filter(options.filter);
  return options.maxFrames === undefined
    ? filtered
    : filtered.slice(0, Math.max(0, options.maxFrames));
}

function frameTimestamp(frame: ServerMessage): number | null {
  return "ts" in frame ? frame.ts : null;
}

function yieldFor(delayMs: number, clock: Clock): Promise<void> {
  return new Promise<void>((resolve) => {
    clock.setTimeout(resolve, delayMs);
  });
}

export class FixtureReplayer {
  private readonly ingest: FixtureIngest;
  private readonly clock: Clock;
  private lastIssues: FixtureReplayIssue[] = [];

  constructor(ingest: FixtureIngest, options?: { clock?: Clock }) {
    this.ingest = ingest;
    this.clock = options?.clock ?? defaultClock();
  }

  get issues(): readonly FixtureReplayIssue[] {
    return this.lastIssues;
  }

  async replay(fixture: FixtureFile, options: FixtureReplayOptions = {}): Promise<void> {
    const { frames, issues } = validateFixtureFrames(fixture);
    this.lastIssues = issues;
    const selected = selectFrames(frames, options);
    const speed = options.speed ?? "instant";
    if (speed === "realtime") {
      await this.replayRealtime(fixture, selected, options);
      return;
    }
    await this.replayInstant(fixture, selected, options.yieldEvery);
  }

  private async replayInstant(
    fixture: FixtureFile,
    frames: ServerMessage[],
    yieldEvery: number | undefined,
  ): Promise<void> {
    const interval = Math.max(1, yieldEvery ?? DEFAULT_YIELD_EVERY);
    let delivered = 0;
    for (const frame of frames) {
      this.ingest(frame, fixture);
      delivered += 1;
      if (delivered % interval === 0) {
        await Promise.resolve();
      }
    }
  }

  private async replayRealtime(
    fixture: FixtureFile,
    frames: ServerMessage[],
    options: FixtureReplayOptions,
  ): Promise<void> {
    const scale = options.timeScale ?? DEFAULT_TIME_SCALE;
    const maxDelay = options.maxDelayMs ?? Number.POSITIVE_INFINITY;
    let previousTs: number | null = null;
    for (const frame of frames) {
      const ts = frameTimestamp(frame);
      if (ts !== null && previousTs !== null) {
        const delay = Math.min(Math.max((ts - previousTs) * scale, 0), maxDelay);
        if (delay > 0) {
          await yieldFor(delay, this.clock);
        }
      }
      if (ts !== null) {
        previousTs = ts;
      }
      this.ingest(frame, fixture);
    }
  }
}

function scenarioTitle(scenario: string): string {
  return scenario
    .split("-")
    .map((word) => {
      const head = word.charAt(0);
      return head.length === 0 ? word : `${head.toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function fixtureSessionState(fixture: FixtureFile): "stopped" | "live" {
  const last = fixture.frames.at(-1);
  const record = asRecord(last?.frame);
  return record?.["type"] === "session_stopped" ? "stopped" : "live";
}

export function fixtureToSessionSeed(fixture: FixtureFile): FixtureSessionSeed {
  return {
    id: `fixture-${fixture.harness}-${fixture.scenario}`,
    harness: fixture.harness,
    state: fixtureSessionState(fixture),
    title: `${fixture.harness}: ${scenarioTitle(fixture.scenario)}`,
  };
}
