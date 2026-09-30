// Port of lexical_stats.dirichlet_log_odds (Monroe, Colaresi and Quinn 2008).
// Both implementations are tested against tests/fixtures/log_odds_example.json.

export const DEFAULT_ALPHA0 = 1000;
export const MIN_COUNT = 3;
export const Z_THRESHOLD = 1.96;

export type LogOddsRow = { ngram: string; count: number; z: number; ratio: number };

export type LogOddsOptions = {
  alpha0?: number;
  minCount?: number;
  zThreshold?: number;
};

// `everyone` includes the target's own counts; `prior` is each phrase's share
// of the whole corpus (all periods). Rows come sorted by decreasing z-score.
export function dirichletLogOdds(
  target: Map<string, number>,
  targetTotal: number,
  everyone: Map<string, number>,
  everyoneTotal: number,
  prior: Map<string, number>,
  options: LogOddsOptions = {},
): LogOddsRow[] {
  const alpha0 = options.alpha0 ?? DEFAULT_ALPHA0;
  const minCount = options.minCount ?? MIN_COUNT;
  const zThreshold = options.zThreshold ?? Z_THRESHOLD;
  const restTotal = everyoneTotal - targetTotal;
  const rows: LogOddsRow[] = [];
  if (targetTotal <= 0 || restTotal <= 0) {
    return rows;
  }
  for (const [phrase, count] of target) {
    if (count < minCount) {
      continue;
    }
    let alpha = alpha0 * (prior.get(phrase) ?? 0);
    if (alpha <= 0) {
      alpha = alpha0 / Math.max(everyoneTotal, 1);
    }
    const rest = Math.max((everyone.get(phrase) ?? count) - count, 0);
    const delta =
      Math.log((count + alpha) / (targetTotal + alpha0 - count - alpha)) -
      Math.log((rest + alpha) / (restTotal + alpha0 - rest - alpha));
    const variance = 1 / (count + alpha) + 1 / (rest + alpha);
    const z = delta / Math.sqrt(variance);
    if (z < zThreshold) {
      continue;
    }
    const ratio = ((count + 0.5) / (targetTotal + 0.5)) / ((rest + 0.5) / (restTotal + 0.5));
    rows.push({ ngram: phrase, count, z, ratio });
  }
  rows.sort((a, b) => b.z - a.z || (a.ngram < b.ngram ? -1 : a.ngram > b.ngram ? 1 : 0));
  return rows;
}
