export interface FuzzyMatch {
  score: number;
  indices: number[];
}

const SEPARATORS = new Set(["/", "-", "_", ".", " ", "@", "+", ":"]);
const SCORE_MATCH = 16;
const SCORE_CONSECUTIVE = 5;
const SCORE_BOUNDARY = 8;
const SCORE_CAMEL = 7;
const SCORE_GAP = -0.75;

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  // Ignore query whitespace while preserving target indices for highlighting.
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (q.length === 0) {
    return null;
  }
  const t = target.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    const targetChar: string | undefined = t[ti];
    if (targetChar === undefined || targetChar !== q[qi]) {
      continue;
    }
    let charScore = SCORE_MATCH;
    if (ti === prev + 1) {
      charScore += SCORE_CONSECUTIVE;
    } else if (prev >= 0) {
      charScore += SCORE_GAP * (ti - prev - 1);
    }
    const prevChar: string | undefined = t[ti - 1];
    if (ti === 0 || (prevChar !== undefined && SEPARATORS.has(prevChar))) {
      charScore += SCORE_BOUNDARY;
    } else if (isCamelBoundary(target, ti)) {
      charScore += SCORE_CAMEL;
    }
    score += charScore;
    indices.push(ti);
    prev = ti;
    qi += 1;
  }
  if (qi < q.length) {
    return null;
  }
  return { score, indices };
}

function isCamelBoundary(target: string, index: number): boolean {
  const prevChar = target.charAt(index - 1);
  const currChar = target.charAt(index);
  if (prevChar.length === 0 || currChar.length === 0) {
    return false;
  }
  return prevChar >= "a" && prevChar <= "z" && currChar >= "A" && currChar <= "Z";
}

export interface RankedModel {
  ref: string;
  score: number;
}

export function rankModelRefs(
  query: string,
  rows: readonly { provider: string; modelId: string }[],
): RankedModel[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const ranked: RankedModel[] = [];
  for (const row of rows) {
    const model = fuzzyMatch(trimmed, row.modelId);
    const provider = fuzzyMatch(trimmed, row.provider);
    const combined = fuzzyMatch(trimmed, `${row.provider}/${row.modelId}`);
    if (model === null && provider === null && combined === null) {
      continue;
    }
    let score = -Infinity;
    if (model !== null) {
      score = model.score + (provider !== null ? provider.score * 0.5 : 0);
    }
    if (combined !== null && combined.score > score) {
      score = combined.score;
    }
    if (score === -Infinity && provider !== null) {
      score = provider.score * 0.5;
    }
    ranked.push({ ref: `${row.provider}/${row.modelId}`, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  return ranked;
}
