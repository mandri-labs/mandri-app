import type { FixtureFile } from "./load";
import { parseServerMessage, type Clock } from "../ws/protocol";
import type { ServerMessage } from "../types/ws";

export interface TimedFrame {
  index: number;
  at: number;
  frame: ServerMessage;
}

/** Arrival timestamps belong to the capture envelope, including response frames. */
export function fixtureTimeline(fixture: FixtureFile): TimedFrame[] {
  const origin = fixture.frames[0]?.ts ?? 0;
  return fixture.frames.map((entry, index) => {
    if (!Number.isFinite(entry.ts)) {
      throw new Error(`Frame ${index}: invalid capture timestamp`);
    }
    const frame = parseServerMessage(entry.frame);
    if (frame === null) throw new Error(`Frame ${index}: invalid WebSocket message`);
    return { index, at: entry.ts - origin, frame };
  });
}

/** A monotonic wall clock drives playback; rendering time never accumulates as drift. */
export class FixturePlayback {
  private timer: unknown;
  private anchor = 0;
  private position = 0;
  private cursor = 0;
  private running = false;
  private disposed = false;
  readonly duration: number;

  constructor(
    readonly frames: readonly TimedFrame[],
    private readonly ingest: (entry: TimedFrame) => void,
    private readonly clock: Clock = {
      now: () => performance.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as number),
    },
  ) {
    this.duration = frames.reduce((end, entry) => Math.max(end, entry.at), 0);
  }

  get elapsed(): number {
    return Math.min(
      this.duration,
      this.running ? this.position + this.clock.now() - this.anchor : this.position,
    );
  }
  get delivered(): number {
    return this.cursor;
  }
  get playing(): boolean {
    return this.running;
  }
  get finished(): boolean {
    return this.cursor === this.frames.length;
  }

  play(): void {
    if (this.disposed || this.running || this.finished) return;
    this.anchor = this.clock.now();
    this.running = true;
    this.tick();
  }
  pause(): void {
    this.position = this.elapsed;
    this.running = false;
    this.clock.clearTimeout(this.timer);
  }
  step(): void {
    if (this.disposed) return;
    this.pause();
    const next = this.frames[this.cursor];
    if (!next) return;
    this.position = Math.max(this.position, next.at);
    this.cursor += 1;
    this.ingest(next);
  }
  dispose(): void {
    this.pause();
    this.disposed = true;
  }
  private tick = (): void => {
    if (!this.running || this.disposed) return;
    let next = this.frames[this.cursor];
    while (next && next.at <= this.elapsed) {
      this.cursor += 1;
      this.ingest(next);
      if (!this.running || this.disposed) return;
      next = this.frames[this.cursor];
    }
    if (!next) {
      this.pause();
      return;
    }
    this.timer = this.clock.setTimeout(this.tick, Math.max(0, next.at - this.elapsed));
  };
}

/** Recover identity metadata absent from these legacy session snapshots. */
export function fixtureNativeId(fixture: FixtureFile): string | undefined {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  for (const entry of fixture.frames) {
    const frame = record(entry.frame);
    if (frame?.source !== fixture.harness) continue;
    const raw = record(frame.raw);
    const properties = record(raw?.properties);
    const params = record(raw?.params);
    const candidate =
      fixture.harness === "opencode"
        ? properties?.sessionID
        : fixture.harness === "claude"
          ? raw?.session_id
          : (params?.threadId ??
            record(params?.thread)?.id ??
            record(record(raw?.result)?.thread)?.id);
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}
