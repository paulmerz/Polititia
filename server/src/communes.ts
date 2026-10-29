import { readFileSync, statSync } from "node:fs";

// communes.json (scripts/build_communes.py) maps each commune, and each
// arrondissement of Paris, Lyon and Marseille, to its postcodes and to the
// constituencies (circonscriptions) that cover it.

export type CommuneMatch = {
  code: string;
  name: string;
  dept: string;
  deptName: string;
  postcodes: string[];
  circos: number[];
};

type Row = [string, string, string, string[], number[]];
type Entry = CommuneMatch & { keys: string[] };
type CommuneIndex = { entries: Entry[]; builtOn: string };

const RESULT_LIMIT = 8;
const ABROAD_CODE = "99";
const ABROAD_KEYS = ["etranger", "francais de l etranger", "hors de france", "expatrie"];

let cache: { path: string; mtimeMs: number; index: CommuneIndex } | null = null;

export function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint");
}

export function loadCommunes(filePath: string): CommuneIndex | null {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return null;
  }
  if (cache && cache.path === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache.index;
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as { builtOn?: string; departments: Record<string, string>; communes: Row[] };
  const entries = raw.communes.map(([code, name, dept, postcodes, circos]) => ({
    code,
    name,
    dept,
    deptName: raw.departments[dept] || "",
    postcodes,
    circos,
    keys: [normalizeQuery(name), ...(code === ABROAD_CODE ? ABROAD_KEYS : [])],
  }));
  const index = { entries, builtOn: raw.builtOn || "" };
  cache = { path: filePath, mtimeMs: stat.mtimeMs, index };
  return index;
}

function nameScore(keys: string[], query: string): number {
  let best = Infinity;
  for (const key of keys) {
    if (key === query) {
      return 0;
    }
    if (key.startsWith(query)) {
      best = Math.min(best, 1);
    } else if (` ${key}`.includes(` ${query}`)) {
      best = Math.min(best, 2);
    } else if (key.includes(query)) {
      best = Math.min(best, 3);
    }
  }
  return best;
}

export function searchCommunes(index: CommuneIndex, raw: string, limit = RESULT_LIMIT): CommuneMatch[] {
  const compact = raw.replace(/\s+/g, "");
  const scored: Array<{ entry: Entry; score: number }> = [];
  const byPostcode = /^\d{2,5}$/.test(compact);
  if (byPostcode) {
    for (const entry of index.entries) {
      if (entry.postcodes.includes(compact)) {
        scored.push({ entry, score: 0 });
      } else if (entry.postcodes.some((postcode) => postcode.startsWith(compact))) {
        scored.push({ entry, score: 1 });
      }
    }
  } else {
    const query = normalizeQuery(raw);
    if (query.length < 2) {
      return [];
    }
    for (const entry of index.entries) {
      const score = nameScore(entry.keys, query);
      if (score < Infinity) {
        scored.push({ entry, score });
      }
    }
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (byPostcode ? a.entry.circos.length - b.entry.circos.length : 0) ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name, "fr") ||
      a.entry.code.localeCompare(b.entry.code),
  );
  return scored.slice(0, limit).map(({ entry: { keys: _keys, ...match } }) => match);
}
