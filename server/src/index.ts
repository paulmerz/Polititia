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
if (config.trustEmail) {
  console.warn("AUTH_TRUST_EMAIL is on: submitting an email creates a session without mailbox proof.");
}
if (!config.hasMailer) {
  console.warn("No Resend mailer configured. Emails are captured to", config.emailsPath);
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
