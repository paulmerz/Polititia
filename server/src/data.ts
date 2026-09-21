import { readFileSync, statSync } from "node:fs";

export type DashboardBundle = {
  meta: Record<string, unknown>;
  partyOrder: string[];
  parties: unknown[];
  politicians: Array<{ id: string } & Record<string, unknown>>;
  phrasesByPolitician: Record<string, unknown>;
  partyPhrases: Record<string, unknown>;
  globalPhrases: Record<string, unknown>;
  languageMarkers: Record<string, unknown>;
};

let cache: { path: string; mtimeMs: number; data: DashboardBundle } | null = null;

export function loadDashboardData(filePath: string): DashboardBundle {
  const stat = statSync(filePath);
  if (cache && cache.path === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache.data;
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as DashboardBundle;
  if (!parsed || !Array.isArray(parsed.politicians) || typeof parsed.phrasesByPolitician !== "object") {
    throw new Error("Invalid dashboard data bundle.");
  }
  cache = { path: filePath, mtimeMs: stat.mtimeMs, data: parsed };
  return parsed;
}

export function bootstrapPayload(data: DashboardBundle) {
  return {
    meta: data.meta,
    partyOrder: data.partyOrder,
    parties: data.parties,
    politicians: data.politicians,
    phrasesByPolitician: {},
    partyPhrases: data.partyPhrases,
    globalPhrases: data.globalPhrases,
    languageMarkers: data.languageMarkers,
  };
}

const POLITICIAN_ID_RE = /^[a-z0-9][a-z0-9-]{0,200}$/;

export function politicianPhrases(data: DashboardBundle, id: string): unknown | null {
  if (!POLITICIAN_ID_RE.test(id)) {
    return null;
  }
  if (!Object.hasOwn(data.phrasesByPolitician, id)) {
    return null;
  }
  return data.phrasesByPolitician[id];
}
