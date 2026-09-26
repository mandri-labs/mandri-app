import { asRecord } from "../../parse/shared";

export { asRecord as record };
export const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
export const identity = (prefix: string, value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? `${prefix}:${value}` : undefined;
export function timestamp(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : undefined;
}

export function belongsTo(expected: string | null | undefined, actual: unknown): boolean {
  return !expected || actual === undefined || expected === actual;
}
