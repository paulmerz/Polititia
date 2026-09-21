import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ORIGIN, POLITICIANS, startTestApp } from "./helpers.ts";

test("bootstrap omits politician phrases and sets a device cookie", async () => {
  const { request } = await startTestApp();
  const response = await request("/api/bootstrap");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") || "", /pt_did=/);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  const body = await response.json();
  assert.equal(Object.keys(body.phrasesByPolitician).length, 0);
  assert.equal(body.quota.remaining, 10);
  assert.equal(body.politicians.length, 12);
});

test("anonymous users get 10 politician payloads then 429", async () => {
  const { request } = await startTestApp();
  await request("/api/bootstrap");
  for (let index = 0; index < 10; index += 1) {
    const response = await request(`/api/politician/${POLITICIANS[index]}`);
    assert.equal(response.status, 200, `request ${index + 1} should pass`);
    const body = await response.json();
    assert.ok(body.phrases);
    assert.equal(body.quota.remaining, 9 - index);
  }
  const blocked = await request(`/api/politician/${POLITICIANS[10]}`);
  assert.equal(blocked.status, 429);
  const payload = await blocked.json();
  assert.equal(payload.error, "quota_exceeded");
  assert.equal(payload.quota.remaining, 0);
});

test("a new cookie on the same IP cannot reset the free quota", async () => {
  const { request, jar } = await startTestApp();
  await request("/api/bootstrap");
  for (const id of POLITICIANS.slice(0, 10)) {
    assert.equal((await request(`/api/politician/${id}`)).status, 200);
  }
  jar.cookies.delete("pt_did");
  const blocked = await request(`/api/politician/${POLITICIANS[10]}`);
  assert.equal(blocked.status, 429);
});

test("registering an email lifts the quota and appends emails.jsonl", async () => {
  const { request, config } = await startTestApp();
  await request("/api/bootstrap");
  for (const id of POLITICIANS.slice(0, 10)) {
    assert.equal((await request(`/api/politician/${id}`)).status, 200);
  }
  assert.equal((await request(`/api/politician/${POLITICIANS[10]}`)).status, 429);

  const registered = await request("/api/register", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "user@example.org" }),
  });
  const registerPayload = await registered.json();
  assert.equal(registered.status, 200, JSON.stringify(registerPayload));
  assert.equal(registerPayload.session, true);

  const unlocked = await request(`/api/politician/${POLITICIANS[10]}`);
  assert.equal(unlocked.status, 200);
  const unlockedBody = await unlocked.json();
  assert.equal(unlockedBody.quota.unlimited, true);

  const emails = readFileSync(config.emailsPath, "utf8");
  assert.match(emails, /user@example\.org/);
});

test("register rejects missing origin and invalid emails", async () => {
  const { request } = await startTestApp();
  const noOrigin = await request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.org" }),
  });
  assert.equal(noOrigin.status, 403);

  const invalid = await request("/api/register", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(invalid.status, 400);
});

test("static dashboard data files are not served", async () => {
  const { request } = await startTestApp();
  for (const path of ["/data/dashboard-data.json", "/data/dashboard-data.js", "/../package.json"]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
  }
});

test("admin emails endpoint requires the bearer token", async () => {
  const { request } = await startTestApp();
  await request("/api/register", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "lead@example.org" }),
  });
  const denied = await request("/api/admin/emails");
  assert.equal(denied.status, 401);
  const allowed = await request("/api/admin/emails", {
    headers: { authorization: "Bearer admin-test-token" },
  });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.emails[0].email, "lead@example.org");
});
