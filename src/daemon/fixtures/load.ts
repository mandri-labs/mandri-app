import type { HarnessKind } from "../types/ws";

const HARNESS_KINDS: readonly string[] = ["claude", "codex", "opencode", "agy", "pi"];

export interface FixtureFrame {
  topic: string | null;
  seq: number | null;
  ts: number;
  frame: unknown;
}

export interface FixtureHistoryCursor {
  cursor: number | null;
  count: number;
  has_more: boolean;
}

export interface FixtureHistory {
  entries: string[];
  cursorTrail?: FixtureHistoryCursor[];
}

export interface FixtureHistoryError {
  code: string;
  message: string;
}

export interface FixtureFile {
  harness: HarnessKind;
  scenario: string;
  modelRef: string;
  capturedAt: string;
  daemonVersionHint?: string;
  cwd?: string;
  partial?: boolean;
  frames: FixtureFrame[];
  history: FixtureHistory;
  historyError?: FixtureHistoryError;
}

export interface FixtureSummary {
  harness: HarnessKind;
  scenario: string;
}

interface FixtureModule {
  default: unknown;
}

const fixtureModules = import.meta.glob<FixtureModule>("../../../tests/fixtures/*/*.json");

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isHarnessKind(value: string): value is HarnessKind {
  return HARNESS_KINDS.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function parseFrame(value: unknown): FixtureFrame | null {
  const record = asRecord(value);
  if (record === undefined) {
    return null;
  }
  if (
    !isStringOrNull(record["topic"]) ||
    !isNumberOrNull(record["seq"]) ||
    typeof record["ts"] !== "number" ||
    !("frame" in record)
  ) {
    return null;
  }
  return record as unknown as FixtureFrame;
}

function parseHistory(value: unknown): FixtureHistory | null {
  const record = asRecord(value);
  const entries = record?.["entries"];
  if (!Array.isArray(entries)) {
    return null;
  }
  for (const entry of entries) {
    if (typeof entry !== "string") {
      return null;
    }
  }
  return record as unknown as FixtureHistory;
}

function parseHistoryError(value: unknown): FixtureHistoryError | null {
  const record = asRecord(value);
  const code = record?.["code"];
  const message = record?.["message"];
  if (typeof code !== "string" || typeof message !== "string") {
    return null;
  }
  return { code, message };
}

function parseFixtureFile(raw: unknown, harness: HarnessKind, scenario: string): FixtureFile | null {
  const record = asRecord(raw);
  const framesValue = record?.["frames"];
  if (!Array.isArray(framesValue)) {
    return null;
  }
  const frames: FixtureFrame[] = [];
  for (const value of framesValue) {
    const frame = parseFrame(value);
    if (frame === null) {
      return null;
    }
    frames.push(frame);
  }
  const history = parseHistory(record?.["history"]);
  if (history === null) {
    return null;
  }
  const modelRef = record?.["modelRef"];
  const capturedAt = record?.["capturedAt"];
  if (typeof modelRef !== "string" || typeof capturedAt !== "string") {
    return null;
  }
  if (record?.["harness"] !== harness || record?.["scenario"] !== scenario) {
    return null;
  }
  const partial = record["partial"];
  if (partial !== undefined && typeof partial !== "boolean") {
    return null;
  }
  const fixture: FixtureFile = {
    harness,
    scenario,
    modelRef,
    capturedAt,
    frames,
    history,
  };
  const daemonVersionHint = record["daemonVersionHint"];
  if (typeof daemonVersionHint === "string") {
    fixture.daemonVersionHint = daemonVersionHint;
  }
  const cwd = record["cwd"];
  if (typeof cwd === "string") {
    fixture.cwd = cwd;
  }
  if (partial === true) {
    fixture.partial = true;
  }
  const historyError = parseHistoryError(record["historyError"]);
  if (historyError !== null) {
    fixture.historyError = historyError;
  }
  return fixture;
}

function compareSummaries(a: FixtureSummary, b: FixtureSummary): number {
  return a.harness.localeCompare(b.harness) || a.scenario.localeCompare(b.scenario);
}

function parseModuleKey(key: string): FixtureSummary | null {
  const match = /tests\/fixtures\/([^/]+)\/([^/]+)\.json$/.exec(key);
  if (match === null) {
    return null;
  }
  const harness = match[1];
  const scenario = match[2];
  if (harness === undefined || scenario === undefined || !isHarnessKind(harness)) {
    return null;
  }
  return { harness, scenario };
}

function fixtureModuleKey(harness: HarnessKind, scenario: string): string {
  return `../../../tests/fixtures/${harness}/${scenario}.json`;
}

export function listFixtures(): FixtureSummary[] {
  const summaries: FixtureSummary[] = [];
  for (const key of Object.keys(fixtureModules)) {
    const summary = parseModuleKey(key);
    if (summary !== null) {
      summaries.push(summary);
    }
  }
  return summaries.sort(compareSummaries);
}

export async function loadFixture(
  harness: HarnessKind,
  scenario: string,
): Promise<FixtureFile | null> {
  const loader = fixtureModules[fixtureModuleKey(harness, scenario)];
  if (loader === undefined) {
    return null;
  }
  const module = await loader();
  return parseFixtureFile(module.default, harness, scenario);
}
