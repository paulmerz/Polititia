import { existsSync } from "node:fs";
import { sendFollowAlerts } from "../src/alerts.ts";
import { openAnalytics } from "../src/analytics.ts";
import { loadConfig } from "../src/config.ts";
import { loadDashboardData } from "../src/data.ts";
import { loadDotEnv } from "../src/load-env.ts";
import { openStore } from "../src/store.ts";

// npm run alerts            preview the next « Suivre mon député » emails
// npm run alerts -- --send  send them (after a corpus update)

loadDotEnv();
const config = loadConfig();
const send = process.argv.includes("--send");

const analytics = openAnalytics(config.analyticsPath);
if (!analytics) {
  console.error("Analytics database missing:", config.analyticsPath);
  process.exit(1);
}
if (send && !config.hasMailer) {
  console.error("RESEND_API_KEY and EMAIL_FROM are required to send alerts.");
  process.exit(1);
}
const db = openStore(config.sqlitePath);
if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'`).get()) {
  console.log("No account yet: nothing to send.");
  process.exit(0);
}
const bundle = existsSync(config.dashboardDataPath) ? loadDashboardData(config.dashboardDataPath) : null;
const run = await sendFollowAlerts(config, db, analytics, bundle, { dryRun: !send });

console.log(`Corpus through ${run.through}: ${run.recipients} account(s) with news, ${run.upToDate} up to date.`);
for (const item of run.preview) {
  console.log(`  ${item.email}: ${item.subject}`);
}
if (send) {
  console.log(`Sent ${run.sent}, failed ${run.failed}.`);
} else if (run.recipients) {
  console.log("Dry run. Add --send to send them.");
}
db.close();
process.exit(run.failed ? 1 : 0);
