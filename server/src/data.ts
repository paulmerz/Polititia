import { readFileSync, statSync } from "node:fs";

// dashboard-data.json (dashboard/build_dashboard_data.py) holds what the
// hemicycle needs on first load. Everything that depends on a person, a
// group, a theme or a period is served by the metered routes instead.
export type DashboardBundle = {
  meta: Record<string, unknown>;
  partyOrder: string[];
  parties: unknown[];
  politicians: Array<{ id: string } & Record<string, unknown>>;
  markersByPolitician: Record<string, unknown>;
  [key: string]: unknown;
};

let cache: { path: string; mtimeMs: number; data: DashboardBundle } | null = null;

export function loadDashboardData(filePath: string): DashboardBundle {
  const stat = statSync(filePath);
  if (cache && cache.path === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache.data;
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as DashboardBundle;
  if (!parsed || !Array.isArray(parsed.politicians)) {
    throw new Error("Invalid dashboard data bundle.");
  }
  parsed.markersByPolitician = parsed.markersByPolitician || {};
  cache = { path: filePath, mtimeMs: stat.mtimeMs, data: parsed };
  return parsed;
}

export function bootstrapPayload(data: DashboardBundle) {
  const { markersByPolitician: _gated, ...rest } = data;
  return rest;
}

export function politicianMarkers(data: DashboardBundle, id: string): unknown | null {
  return Object.hasOwn(data.markersByPolitician, id) ? data.markersByPolitician[id] : null;
}
