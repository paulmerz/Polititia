// Selection rules for interruptions, reactions, wording and rising phrases.
// Counts come from analytics.sqlite; nothing here reads the corpus.

export const FAVORITE_MIN_COUNT = 3;
export const FAVORITE_MIN_SITTINGS = 3;
export const FAVORITE_SHARE = 2;
export const MENTION_MIN_COUNT = 3;
export const MENTION_MIN_SITTINGS = 3;
// Below this, a rate per 1 000 words moves too much with one speech.
export const WORDING_MIN_WORDS = 1000;
// A deputy is ranked against the others once present in this many sittings.
export const RANK_MIN_SITTINGS = 10;
// A wording rate is shown when it is among the 10 % highest or lowest of the
// deputies, or, for a group, a quarter away from the chamber.
export const WORDING_DECILE = 0.1;
export const WORDING_GROUP_RATIO = 1.25;
// « Il s'en fout ! » can be applauded, but says little quoted alone.
export const MOMENT_MIN_WORDS = 6;
export const MIN_RISE_COUNT = 15;
export const MIN_RISE_LIFT = 1.5;

export const WORDING_KEYS = ["negation", "obligation", "possibility", "je", "nous", "vous"] as const;
export type WordingKey = (typeof WORDING_KEYS)[number];

const RISING_STOP = new Set([
  "amendement",
  "amendements",
  "article",
  "articles",
  "commission",
  "gouvernement",
  "loi",
  "madame",
  "monsieur",
  "projet",
  "scrutin",
  "seance",
  "séance",
  "texte",
]);

export type StyleCounts = {
  words: number;
  negation: number;
  obligation: number;
  possibility: number;
  je: number;
  nous: number;
  vous: number;
};

export type CountedLine = {
  norm: string;
  quote: string;
  count: number;
  sittings: number;
  rest: number;
  date: string;
  sessionUid: string;
  debate: string;
};

export type WordingSubject = "il" | "elle" | "groupe";

export function perThousand(count: number, words: number): number {
  return words > 0 ? (count * 1000) / words : 0;
}

export function perMember(count: number, members: number): number | null {
  if (members <= 0) {
    return null;
  }
  return count / members;
}

export type Rank = { higher: number; lower: number; pool: number };

// Where `value` sits among `pool`: how many are strictly above and below it.
export function rankAmong(value: number, pool: number[]): Rank | null {
  if (pool.length < 2) {
    return null;
  }
  let higher = 0;
  let lower = 0;
  for (const other of pool) {
    if (other > value) {
      higher += 1;
    } else if (other < value) {
      lower += 1;
    }
  }
  return { higher, lower, pool: pool.length };
}

export function median(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(sorted: number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))))];
}

export type WordingStandout = { key: WordingKey; rate: number; chamber: number; ratio: number };

// Rates worth a line: among the deputies' top or bottom decile (people), or a
// quarter away from the chamber (groups). Largest gaps first.
export function wordingStandouts(
  style: StyleCounts,
  chamber: StyleCounts,
  pools: Record<WordingKey, number[]> | null,
): WordingStandout[] {
  if (style.words < WORDING_MIN_WORDS || chamber.words <= 0) {
    return [];
  }
  const found: WordingStandout[] = [];
  for (const key of WORDING_KEYS) {
    const rate = perThousand(style[key], style.words);
    const reference = perThousand(chamber[key], chamber.words);
    if (reference <= 0) {
      continue;
    }
    const ratio = rate / reference;
    let stands: boolean;
    if (pools) {
      const sorted = [...pools[key]].sort((a, b) => a - b);
      if (sorted.length < 20) {
        continue;
      }
      stands = rate >= quantile(sorted, 1 - WORDING_DECILE) || rate <= quantile(sorted, WORDING_DECILE);
    } else {
      stands = ratio >= WORDING_GROUP_RATIO || ratio <= 1 / WORDING_GROUP_RATIO;
    }
    if (stands && ratio !== 1) {
      found.push({ key, rate, chamber: reference, ratio });
    }
  }
  return found.sort((a, b) => Math.abs(Math.log(b.ratio || 1e-6)) - Math.abs(Math.log(a.ratio || 1e-6))).slice(0, 3);
}

export function selectFavorites(lines: CountedLine[], personTotal: number, restTotal: number, limit = 5): CountedLine[] {
  return lines
    .filter((line) => {
      if (line.count < FAVORITE_MIN_COUNT || line.sittings < FAVORITE_MIN_SITTINGS || personTotal <= 0) {
        return false;
      }
      if (line.rest <= 0) {
        return true;
      }
      if (restTotal <= 0) {
        return false;
      }
      return line.count / personTotal >= FAVORITE_SHARE * (line.rest / restTotal);
    })
    .sort((a, b) => b.count - a.count || b.sittings - a.sittings || a.quote.localeCompare(b.quote, "fr"))
    .slice(0, limit);
}

// The applauded sentences worth quoting: long enough to say something, each
// once, the widest applause first (rows arrive sorted that way).
export function selectMoments<T extends { norm: string }>(rows: T[], limit = 3): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    if (row.norm.split(" ").filter(Boolean).length < MOMENT_MIN_WORDS || seen.has(row.norm)) {
      continue;
    }
    seen.add(row.norm);
    kept.push(row);
    if (kept.length >= limit) {
      break;
    }
  }
  return kept;
}

export function wordingSentence(style: StyleCounts, chamber: StyleCounts, subject: WordingSubject): string {
  if (style.words < WORDING_MIN_WORDS || chamber.words <= 0) {
    return "";
  }
  const obligation = perThousand(style.obligation, style.words);
  const possibility = perThousand(style.possibility, style.words);
  const chamberObligation = perThousand(chamber.obligation, chamber.words);
  const chamberPossibility = perThousand(chamber.possibility, chamber.words);
  const who = subject === "groupe" ? "Le groupe formule" : subject === "elle" ? "Elle formule" : "Il formule";
  if (obligation >= 2 && obligation >= possibility * 1.5 && obligation >= chamberObligation * 1.5) {
    return `${who} plus d'obligations que de possibilités, et plus que l'hémicycle.`;
  }
  if (possibility >= 2 && possibility >= obligation * 1.5 && possibility >= chamberPossibility * 1.5) {
    return `${who} plus de possibilités que d'obligations, et plus que l'hémicycle.`;
  }
  return "";
}

export function monthSpan(from: string, to: string): number {
  const [startYear, startMonth] = from.split("-").map(Number);
  const [endYear, endMonth] = to.split("-").map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousWindow(from: string, to: string, firstMonth: string): { from: string; to: string } | null {
  const span = monthSpan(from, to);
  const prevTo = shiftMonth(from, -1);
  const prevFrom = shiftMonth(prevTo, -(span - 1));
  if (prevFrom < firstMonth) {
    return null;
  }
  return { from: prevFrom, to: prevTo };
}

export type RiseRow = { ngram: string; now: number; previous: number };

export function risingPhrases(rows: RiseRow[], nowTotal: number, previousTotal: number) {
  if (nowTotal <= 0 || previousTotal <= 0) {
    return [];
  }
  return rows
    .filter((row) => row.now >= MIN_RISE_COUNT && !row.ngram.split(" ").some((token) => RISING_STOP.has(token)))
    .map((row) => ({
      ...row,
      lift: row.now / nowTotal / ((row.previous + 0.5) / previousTotal),
    }))
    .filter((row) => row.lift >= MIN_RISE_LIFT && row.now > row.previous)
    .sort((a, b) => b.lift - a.lift || b.now - a.now || a.ngram.localeCompare(b.ngram, "fr"))
    .slice(0, 5)
    .map(({ ngram, now, previous, lift }) => ({ ngram, now, previous, lift }));
}
