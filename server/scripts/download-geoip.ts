// Downloads the free DB-IP Lite database (CC BY 4.0, no account needed) used
// by /admin to place sign-ins and requests on a map of countries and cities.
//   npm run geoip                 city precision (about 130 MB on disk and in memory)
//   npm run geoip -- --country    country precision only (about 8 MB)
//   npm run geoip -- --if-stale   only when the file is missing, older than 30 days
//                                 or of the other precision; never fails, so it can
//                                 run before `npm start` on hosts whose disk is only
//                                 mounted at runtime (Render).
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Reader } from "mmdb-lib";
import { loadConfig } from "../src/config.ts";
import { loadDotEnv } from "../src/load-env.ts";

const MAX_AGE_DAYS = 30;

loadDotEnv();
const config = loadConfig();
const edition = process.argv.includes("--country") ? "country" : "city";
const ifStale = process.argv.includes("--if-stale");
const expectedType = edition === "country" ? "DBIP-Country-Lite" : "DBIP-City-Lite";

function currentFileIsFresh(): boolean {
  if (!existsSync(config.geoipPath)) {
    return false;
  }
  const ageDays = (Date.now() - statSync(config.geoipPath).mtimeMs) / (24 * 60 * 60 * 1000);
  if (ageDays > MAX_AGE_DAYS) {
    return false;
  }
  try {
    return new Reader(readFileSync(config.geoipPath)).metadata.databaseType === expectedType;
  } catch {
    return false;
  }
}

// A month's file is published during that month: fall back to the previous one.
function candidateMonths(now = new Date()): string[] {
  const months = [];
  for (let back = 0; back < 2; back += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}

async function download(): Promise<void> {
  let compressed: Buffer | null = null;
  let source = "";
  for (const month of candidateMonths()) {
    source = `https://download.db-ip.com/free/dbip-${edition}-lite-${month}.mmdb.gz`;
    const response = await fetch(source);
    if (response.ok) {
      compressed = Buffer.from(await response.arrayBuffer());
      break;
    }
    console.warn(`${source}: HTTP ${response.status}`);
  }
  if (!compressed) {
    throw new Error("No DB-IP Lite file could be downloaded.");
  }
  const database = gunzipSync(compressed);
  const reader = new Reader(database);
  mkdirSync(path.dirname(config.geoipPath), { recursive: true, mode: 0o700 });
  const temporary = `${config.geoipPath}.tmp`;
  writeFileSync(temporary, database);
  renameSync(temporary, config.geoipPath);
  console.log(
    `${source} -> ${config.geoipPath} (${reader.metadata.databaseType}, ${(database.length / 1e6).toFixed(0)} MB).`,
  );
  console.log("A running server picks it up within 10 minutes.");
}

if (ifStale && currentFileIsFresh()) {
  console.log(`${config.geoipPath} is less than ${MAX_AGE_DAYS} days old: kept.`);
} else {
  try {
    await download();
  } catch (error) {
    console.error("[geoip]", error instanceof Error ? error.message : error);
    // Geolocation is optional: a download failure must not stop the server from starting.
    process.exitCode = ifStale ? 0 : 1;
  }
}
