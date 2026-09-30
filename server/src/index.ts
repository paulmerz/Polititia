import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { loadDotEnv } from "./load-env.ts";
import { assertSafeHostBinding, loadConfig } from "./config.ts";
import { createApp } from "./app.ts";

loadDotEnv();

const config = loadConfig();
assertSafeHostBinding(config);

if (config.usingDevSecret) {
  console.warn("Auth secret is a development default. Set BETTER_AUTH_SECRET before production.");
}
if (config.exposeMagicLink) {
  console.warn("No Resend mailer configured: magic links are logged and shown in the browser (development only).");
}
if (!existsSync(config.analyticsPath)) {
  console.warn("Analytics database missing:", config.analyticsPath, "- run build_analytics_db.py.");
}

const { app } = await createApp(config);

serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    console.log(`Polititia listening on http://${info.address}:${info.port}`);
  },
);
