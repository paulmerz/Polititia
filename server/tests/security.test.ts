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

test("production accepts https with a long secret", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: "production-secret-production-secret-xx",
    BETTER_AUTH_URL: "https://polititia.example",
    DATA_DIR: "/tmp/polititia-prod-config",
  });
  assert.equal(config.isProduction, true);
  assert.equal(config.trustEmail, true);
});
