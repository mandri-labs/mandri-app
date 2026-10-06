export function mergeAgyHistory(
  previous: readonly string[],
  incoming: readonly string[],
): string[] {
  const records = new Map<string | number, string>();
  for (const line of [...previous, ...incoming]) {
    let key: string | number = line;
    try {
      const record: unknown = JSON.parse(line);
      if (
        record &&
        typeof record === "object" &&
        "step_index" in record &&
        typeof record.step_index === "number"
      )
        key = record.step_index;
    } catch {
      /* Preserve malformed records for the raw renderer. */
    }
    records.set(key, line);
  }
  return [...records]
    .sort(([a], [b]) => (typeof a === "number" && typeof b === "number" ? a - b : 0))
    .map(([, line]) => line);
}
