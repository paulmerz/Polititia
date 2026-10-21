import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openAnalytics } from "../src/analytics.ts";
import { loadConfig } from "../src/config.ts";
import { loadDashboardData } from "../src/data.ts";
import { loadDotEnv } from "../src/load-env.ts";
import {
  amoContact,
  amoSittingDeputies,
  departmentDossiers,
  deputyCsv,
  DEPUTY_TEMPLATE,
  outreachRows,
  pressIndexCsv,
  sittingDeputies,
} from "../src/outreach.ts";

// npm run outreach -- --base https://polititia.fr
//   outreach/deputes.csv              one mail-merge row per sitting deputy
//   outreach/modele-email-depute.txt  the message, with {{column}} fields
//   outreach/pqr/<dept>-<name>.md     one press dossier per department
//   outreach/pqr/index.csv            the list of dossiers, for the press mailing

loadDotEnv();
const config = loadConfig();
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const baseURL = argument("--base") || config.baseURL;
const outDir = path.resolve(argument("--out") || path.join(repoRoot, "outreach"));
const amoDir = path.resolve(argument("--amo") || path.join(repoRoot, "data", "raw", "opendata", "amo", "json", "acteur"));

const analytics = openAnalytics(config.analyticsPath);
if (!analytics) {
  console.error("Analytics database missing:", config.analyticsPath);
  process.exit(1);
}
if (!existsSync(config.dashboardDataPath)) {
  console.error("Dashboard bundle missing:", config.dashboardDataPath);
  process.exit(1);
}
if (!existsSync(amoDir)) {
  console.error("AMO actors missing (python scripts/download_open_data.py):", amoDir);
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/.test(baseURL)) {
  console.warn(`Links point to ${baseURL}. Pass --base https://your-domain for the real mailing.`);
}

const bundle = loadDashboardData(config.dashboardDataPath);
const rows = outreachRows(analytics, bundle, baseURL, (acteurId) => amoContact(amoDir, acteurId));
const dossiers = departmentDossiers(rows, analytics, baseURL);

rmSync(path.join(outDir, "pqr"), { recursive: true, force: true });
mkdirSync(path.join(outDir, "pqr"), { recursive: true });
writeFileSync(path.join(outDir, "deputes.csv"), deputyCsv(rows));
writeFileSync(path.join(outDir, "modele-email-depute.txt"), DEPUTY_TEMPLATE);
for (const dossier of dossiers) {
  writeFileSync(path.join(outDir, "pqr", dossier.file), dossier.markdown);
}
writeFileSync(path.join(outDir, "pqr", "index.csv"), pressIndexCsv(dossiers, rows));

const missing = rows.filter((row) => !row.email);
const segments = Object.groupBy(rows, (row) => row.segment);
console.log(`${rows.length} sitting deputies, ${rows.length - missing.length} with an email (corpus ${analytics.meta.firstDate} → ${analytics.meta.lastDate}).`);
console.log(`Segments: ${Object.entries(segments).map(([key, items]) => `${key} ${items?.length}`).join(", ")}.`);
for (const row of missing) {
  console.log(`  no email: ${row.fullName} (${row.deptName}, ${row.circoLabel})`);
}
const exported = new Set(sittingDeputies(bundle).map((person) => String(person.acteurId || "")));
const withoutPage = amoSittingDeputies(amoDir).filter((deputy) => !exported.has(deputy.acteurId));
if (withoutPage.length) {
  console.log(`${withoutPage.length} sitting deputies have no dashboard page yet (never spoke in the corpus), left out:`);
  for (const deputy of withoutPage) {
    console.log(`  ${deputy.name} (${deputy.deptName}, ${deputy.circo})`);
  }
}
console.log(`${dossiers.length} press dossiers in ${path.join(outDir, "pqr")}.`);
