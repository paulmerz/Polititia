import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";

test("production refuses a short secret", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "short",
        BETTER_AUTH_URL: "https://polititia.example",
      }),
    /BETTER_AUTH_SECRET/,
  );
});

test("production refuses http unless explicitly allowed", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "production-secret-production-secret-xx",
        BETTER_AUTH_URL: "http://polititia.example",
      }),
    /https/,
  );
});

test("production refuses to start without a mailer", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "production-secret-production-secret-xx",
        BETTER_AUTH_URL: "https://polititia.example",
        DATA_DIR: "/tmp/polititia-prod-config",
      }),
    /RESEND_API_KEY/,
  );
});

test("production accepts https, a long secret and a mailer", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: "production-secret-production-secret-xx",
    BETTER_AUTH_URL: "https://polititia.example",
    DATA_DIR: "/tmp/polititia-prod-config",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Polititia <no-reply@polititia.example>",
  });
  assert.equal(config.isProduction, true);
  assert.equal(config.exposeMagicLink, false);
});

test("development without a mailer shows the magic link instead of emailing it", () => {
  const config = loadConfig({ NODE_ENV: "development", DATA_DIR: "/tmp/polititia-dev-config" });
  assert.equal(config.exposeMagicLink, true);
});

test("Turnstile needs both keys", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "development", DATA_DIR: "/tmp/polititia-dev-config", TURNSTILE_SITE_KEY: "site" }),
    /TURNSTILE/,
  );
});
