// Downloads the free DB-IP Lite database (CC BY 4.0, no account needed) used
// by /admin to place sign-ins and requests on a map of countries and cities.
//   npm run geoip            city precision (about 130 MB on disk and in memory)
//   npm run geoip -- --country   country precision only (about 8 MB)
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Reader } from "mmdb-lib";
import { loadConfig } from "../src/config.ts";
import { loadDotEnv } from "../src/load-env.ts";

loadDotEnv();
const config = loadConfig();
const edition = process.argv.includes("--country") ? "country" : "city";

// A month's file is published during that month: fall back to the previous one.
function candidateMonths(now = new Date()): string[] {
  const months = [];
  for (let back = 0; back < 2; back += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}

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
  console.error("No DB-IP Lite file could be downloaded.");
  process.exit(1);
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
console.log("The running server picks it up within 10 minutes.");
