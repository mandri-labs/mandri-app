import { afterEach, describe, expect, it, vi } from "vitest";
import { FixturePlayback, fixtureTimeline, fixtureNativeId } from "@/daemon/fixtures/playback";
import { listFixtures, loadFixture, type FixtureFile } from "@/daemon/fixtures";

const fixture: FixtureFile = {
  harness: "claude",
  scenario: "timing",
  modelRef: "recorded",
  capturedAt: "",
  history: { entries: [] },
  frames: [
    {
      topic: null,
      seq: null,
      ts: 1000,
      frame: { type: "response", op_id: "prompt", ok: true, result: {} },
    },
    {
      topic: "session.test",
      seq: 1,
      ts: 1800,
      frame: { topic: "session.test", seq: 1, source: "claude", raw: {}, ts: 10 },
    },
    {
      topic: null,
      seq: null,
      ts: 2500,
      frame: { type: "response", op_id: "interrupt", ok: true, result: {} },
    },
  ],
};
const clock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: unknown) => clearTimeout(id as number),
};
afterEach(() => vi.useRealTimers());

describe("recorded session playback", () => {
  it("uses every arrival timestamp, including responses and frames with a different internal timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const marks: number[] = [];
    const player = new FixturePlayback(
      fixtureTimeline(fixture),
      () => marks.push(Date.now()),
      clock,
    );
    player.play();
    vi.advanceTimersByTime(1499);
    expect(marks).toEqual([0, 800]);
    vi.advanceTimersByTime(1);
    expect(marks).toEqual([0, 800, 1500]);
    expect(player.finished).toBe(true);
    expect(player.playing).toBe(false);
  });
  it("pauses the remaining delay, steps once, and cancels outstanding work on disposal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ingest = vi.fn();
    const player = new FixturePlayback(fixtureTimeline(fixture), ingest, clock);
    player.play();
    vi.advanceTimersByTime(300);
    player.pause();
    vi.advanceTimersByTime(5000);
    expect(player.elapsed).toBe(300);
    expect(ingest).toHaveBeenCalledTimes(1);
    player.play();
    vi.advanceTimersByTime(499);
    expect(ingest).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(ingest).toHaveBeenCalledTimes(2);
    player.step();
    expect(player.elapsed).toBe(1500);
    expect(ingest).toHaveBeenCalledTimes(3);
    const cancelled = new FixturePlayback(fixtureTimeline(fixture), ingest, clock);
    cancelled.play();
    cancelled.dispose();
    cancelled.play();
    cancelled.step();
    vi.advanceTimersByTime(5000);
    expect(ingest).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not accumulate time spent ingesting events", () => {
    let now = 0;
    const delays: number[] = [];
    const player = new FixturePlayback(
      fixtureTimeline(fixture),
      () => {
        now += 100;
      },
      {
        now: () => now,
        setTimeout: (_fn, delay) => delays.push(delay),
        clearTimeout: () => undefined,
      },
    );
    player.play();
    expect(delays).toEqual([700]);
    player.dispose();
  });
  it("validates all existing recorded fixtures without filtering or changing payloads", async () => {
    for (const { harness, scenario } of listFixtures().filter((entry) => entry.harness !== "agy")) {
      const capture = (await loadFixture(harness, scenario))!;
      const timeline = fixtureTimeline(capture);
      expect(timeline).toHaveLength(capture.frames.length);
      expect(timeline.map((entry) => entry.frame)).toEqual(
        capture.frames.map((entry) => entry.frame),
      );
    }
  });
  it("preserves wire order when capture timestamps move backwards slightly", () => {
    const capture = {
      ...fixture,
      frames: [fixture.frames[0]!, fixture.frames[1]!, { ...fixture.frames[2]!, ts: 1799 }],
    };
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const delivered: number[] = [];
    const player = new FixturePlayback(
      fixtureTimeline(capture),
      (entry) => delivered.push(entry.index),
      clock,
    );
    player.play();
    vi.advanceTimersByTime(800);
    expect(delivered).toEqual([0, 1, 2]);
    expect(player.finished).toBe(true);
  });
  it("recovers the native identity needed to follow OpenCode activity", async () => {
    const capture = (await loadFixture("opencode", "approval"))!;
    expect(fixtureNativeId(capture)).toBe("ses_f91e5c940ffe3dNwKYMICq343i");
  });
  it("rejects malformed frames instead of silently dropping them", () => {
    expect(() =>
      fixtureTimeline({ ...fixture, frames: [{ ...fixture.frames[0]!, ts: NaN }] }),
    ).toThrow("timestamp");
    expect(() =>
      fixtureTimeline({
        ...fixture,
        frames: [{ ...fixture.frames[0]!, frame: { type: "unknown" } }],
      }),
    ).toThrow("WebSocket");
  });
});
