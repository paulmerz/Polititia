import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { ORIGIN, POLITICIANS, startTestApp } from "./helpers.ts";

function devEnv(env: Record<string, string>) {
  return { NODE_ENV: "development", DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "polititia-dev-")), ...env };
}

function politicianViews(count: number): string[] {
  const views: string[] = [];
  for (const id of POLITICIANS) {
    for (const month of ["2025-01", "2025-02", "2025-03"]) {
      views.push(`/api/politician/${id}?from=${month}&to=${month}`);
    }
  }
  return views.slice(0, count);
}

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

test("development mode never serves beyond this machine with the public secret or shown links", () => {
  const { DATA_DIR } = devEnv({});
  assert.throws(() => loadConfig({ HOST: "0.0.0.0", DATA_DIR }), /NODE_ENV=production/, "a missing NODE_ENV is development");
  const secret = { BETTER_AUTH_SECRET: "a-real-secret-a-real-secret-a-real-secret" };
  const remote: Array<Record<string, string>> = [{ HOST: "0.0.0.0" }, { BETTER_AUTH_URL: "https://polititia.example" }];
  for (const env of remote) {
    assert.throws(() => loadConfig(devEnv(env)), /NODE_ENV=production/, JSON.stringify(env));
    assert.equal(loadConfig(devEnv({ ...env, ...secret })).exposeMagicLink, false, JSON.stringify(env));
  }
});

test("TRUST_PROXY accepts off, on, a number of proxies or cloudflare", () => {
  const read = (value: string) => {
    const config = loadConfig(devEnv({ TRUST_PROXY: value }));
    return [config.proxyHops, config.trustCloudflare, config.trustProxy];
  };
  assert.deepEqual(read("0"), [0, false, false]);
  assert.deepEqual(read("1"), [1, false, true]);
  assert.deepEqual(read("true"), [1, false, true]);
  assert.deepEqual(read("2"), [2, false, true]);
  assert.deepEqual(read("cloudflare"), [0, true, true]);
});

test("replaying one interaction id does not unlock every analysis", async () => {
  const { client } = await startTestApp();
  const visitor = client({ "x-forwarded-for": "203.0.113.40" });
  const statuses: number[] = [];
  for (const view of politicianViews(14)) {
    statuses.push((await visitor.request(view, { headers: { "x-interaction-id": "replayed-0000001" } })).status);
  }
  // One action (4 views) is counted once, then each replay is counted: 1 + 9 = 10.
  assert.deepEqual(statuses.slice(0, 13), Array(13).fill(200));
  assert.equal(statuses[13], 429);
});

test("a forged X-Forwarded-For entry does not reset the quota behind a proxy", async () => {
  const { client } = await startTestApp();
  const views = politicianViews(11);
  for (const [index, view] of views.entries()) {
    // A new cookie every time, a new forged address every time; the proxy appends the real one.
    const visitor = client({ "x-forwarded-for": `198.51.100.${index + 1}, 203.0.113.41` });
    assert.equal((await visitor.request(view)).status, index < 10 ? 200 : 429, view);
  }
});

test("without a trusted proxy, visitors are told apart by their socket address", async () => {
  const { client } = await startTestApp({}, { TRUST_PROXY: "0" });
  const views = politicianViews(11);
  const alice = client({}, "192.0.2.10");
  for (const view of views.slice(0, 10)) {
    assert.equal((await alice.request(view)).status, 200);
  }
  const aliceAgain = client({ "x-forwarded-for": "198.51.100.200" }, "192.0.2.10");
  assert.equal((await aliceAgain.request(views[10])).status, 429, "X-Forwarded-For is ignored without a proxy");
  assert.equal((await client({}, "192.0.2.11").request(views[10])).status, 200, "another visitor keeps their quota");

  const statuses: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    statuses.push((await client({}, `192.0.2.${20 + index}`).register(`person${index}@example.org`)).status);
  }
  assert.deepEqual(statuses, Array(6).fill(200), "the hourly sign-up limit is per visitor");
});

test("only the Better Auth endpoints the dashboard uses are reachable", async () => {
  const { request, pending } = await startTestApp();
  const json = { origin: ORIGIN, "content-type": "application/json" };
  const blocked: Array<[string, RequestInit]> = [
    ["/api/auth/sign-in/magic-link", { method: "POST", headers: json, body: JSON.stringify({ email: "victim@yopmail.com" }) }],
    ["/api/auth/sign-in/magic-link/", { method: "POST", headers: json, body: JSON.stringify({ email: "victim@example.org" }) }],
    ["/api/auth/update-user", { method: "POST", headers: json, body: JSON.stringify({ name: "x" }) }],
    ["/api/auth/get-session", {}],
    ["/api/auth/sign-out", {}],
    ["/api/auth/magic-link/verify", { method: "POST", headers: json, body: "{}" }],
  ];
  for (const [url, init] of blocked) {
    assert.equal((await request(url, init)).status, 404, `${init.method || "GET"} ${url}`);
  }
  assert.equal(pending.size, 0);
  assert.equal((await request("/api/auth/sign-out", { method: "POST", headers: { origin: ORIGIN } })).status, 200);
  assert.equal((await request("/api/auth/sign-out", { method: "POST", headers: { origin: "https://evil.example" } })).status, 403);
});

test("fake links from one visitor do not block another visitor's sign-in", async () => {
  const { client } = await startTestApp({}, { TRUST_PROXY: "0" });
  const attacker = client({}, "192.0.2.66");
  for (let index = 0; index < 8; index += 1) {
    // Better Auth must not be fooled by a client-chosen address either.
    const headers = { "x-polititia-client-ip": `198.51.100.${index}`, "x-forwarded-for": `198.51.100.${index}` };
    await attacker.request(`/api/auth/magic-link/verify?token=bogus${index}&callbackURL=/`, { headers, redirect: "manual" });
  }
  const limited = await attacker.request("/api/auth/magic-link/verify?token=bogus&callbackURL=/", { redirect: "manual" });
  assert.equal(limited.status, 429, "the attacker is limited on their own address");

  const victim = client({}, "192.0.2.67");
  const { devLink } = await (await victim.register("victim@example.org")).json();
  const verified = await victim.verify(devLink);
  assert.equal(verified.status, 302);
  assert.doesNotMatch(verified.headers.get("location") || "", /error=/);
});

test("Turnstile needs both keys", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "development", DATA_DIR: "/tmp/polititia-dev-config", TURNSTILE_SITE_KEY: "site" }),
    /TURNSTILE/,
  );
});
