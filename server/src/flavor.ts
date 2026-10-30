// Selection rules for interruptions, reactions, wording and rising phrases.
// Counts come from analytics.sqlite; nothing here reads the corpus.

export const FAVORITE_MIN_COUNT = 3;
export const FAVORITE_MIN_SITTINGS = 3;
export const FAVORITE_SHARE = 2;
export const REACTION_MIN_COUNT = 2;
export const REACTION_MIN_SITTINGS = 2;
export const MENTION_MIN_COUNT = 3;
export const MENTION_MIN_SITTINGS = 3;
export const WORDING_MIN_WORDS = 200;
export const MIN_RISE_COUNT = 15;
export const MIN_RISE_LIFT = 1.5;

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

export function perHundred(count: number, otherSpeeches: number): number | null {
  if (otherSpeeches <= 0) {
    return null;
  }
  return (count * 100) / otherSpeeches;
}

export function perMember(count: number, members: number): number | null {
  if (members <= 0) {
    return null;
  }
  return count / members;
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

export function selectReactions<T extends { count: number; sittings: number }>(rows: T[], limit = 3): T[] {
  return rows
    .filter((row) => row.count >= REACTION_MIN_COUNT && row.sittings >= REACTION_MIN_SITTINGS)
    .sort((a, b) => b.count - a.count || b.sittings - a.sittings)
    .slice(0, limit);
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
