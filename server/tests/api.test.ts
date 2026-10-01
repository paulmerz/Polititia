import assert from "node:assert/strict";
import test from "node:test";
import { BOB } from "./analytics-fixture.ts";
import { ORIGIN, POLITICIANS, startTestApp } from "./helpers.ts";

test("bootstrap is free, withholds markers and describes the periods", async () => {
  const { request } = await startTestApp();
  const response = await request("/api/bootstrap");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") || "", /pt_did=/);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(response.headers.get("strict-transport-security"), null);
  const body = await response.json();
  assert.equal(body.markersByPolitician, undefined);
  assert.equal(body.politicians.length, 14);
  assert.deepEqual(body.analytics.months, ["2025-01", "2025-02", "2025-03", "2025-06"]);
  assert.equal(body.analytics.sessions[0].label, "Session 2024-2025");
  assert.ok(body.analytics.themes.some((theme: { id: string }) => theme.id === "fin-de-vie"));
  assert.equal(body.auth.verification, true);
  assert.equal(body.quota.remaining, 10);

  const again = await (await request("/api/bootstrap")).json();
  assert.equal(again.quota.remaining, 10, "reloading the page never consumes an analysis");
});

test("anonymous visitors get 10 analyses, the 11th opens the gate", async () => {
  const { request } = await startTestApp();
  await request("/api/bootstrap");
  for (let index = 0; index < 10; index += 1) {
    const response = await request(`/api/politician/${POLITICIANS[index]}`);
    assert.equal(response.status, 200, `analysis ${index + 1} should pass`);
    const body = await response.json();
    assert.ok(body.words);
    assert.equal(body.quota.remaining, 9 - index);
  }
  const blocked = await request(`/api/politician/${POLITICIANS[10]}`);
  assert.equal(blocked.status, 429);
  const payload = await blocked.json();
  assert.equal(payload.error, "quota_exceeded");
  assert.equal(payload.quota.remaining, 0);
});

test("groups, themes, the Assembly and periods are all counted", async () => {
  const { request } = await startTestApp();
  const paths = [
    "/api/party/LFI_NFP",
    "/api/theme/fin-de-vie",
    "/api/assembly",
    "/api/assembly?from=2025-01&to=2025-02",
    `/api/politician/${POLITICIANS[0]}?from=2025-03&to=2025-03`,
  ];
  let remaining = 10;
  for (const path of paths) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    remaining -= 1;
    assert.equal((await response.json()).quota.remaining, remaining, path);
  }
});

test("requests sent for one action share an interaction id and count once", async () => {
  const { request } = await startTestApp();
  const headers = { "x-interaction-id": "period-change-0001" };
  const first = await request("/api/assembly?from=2025-02&to=2025-06", { headers });
  const second = await request(`/api/politician/${BOB}?from=2025-02&to=2025-06`, { headers });
  assert.equal((await first.json()).quota.remaining, 9);
  assert.equal((await second.json()).quota.remaining, 9);
});

test("reopening a view already counted on this device is free", async () => {
  const { request } = await startTestApp();
  for (const id of POLITICIANS.slice(0, 10)) {
    assert.equal((await request(`/api/politician/${id}`)).status, 200);
  }
  assert.equal((await request(`/api/politician/${POLITICIANS[10]}`)).status, 429);
  const reopened = await request(`/api/politician/${POLITICIANS[3]}`);
  assert.equal(reopened.status, 200);
  assert.equal((await request(`/api/politician/${POLITICIANS[3]}?from=2025-01&to=2025-01`)).status, 429);
});

test("a new cookie on the same IP cannot reset the free quota", async () => {
  const { request, jar } = await startTestApp();
  await request("/api/bootstrap");
  for (const id of POLITICIANS.slice(0, 10)) {
    assert.equal((await request(`/api/politician/${id}`)).status, 200);
  }
  jar.cookies.delete("pt_did");
  assert.equal((await request(`/api/politician/${POLITICIANS[10]}`)).status, 429);
});

test("invalid periods and unknown ids are rejected without counting", async () => {
  const { request } = await startTestApp();
  assert.equal((await request("/api/assembly?from=2025-13&to=2025-02")).status, 400);
  assert.equal((await request("/api/assembly?from=2025-06&to=2025-01")).status, 400);
  assert.equal((await request("/api/politician/..%2Fetc")).status, 404);
  const body = await (await request("/api/quota")).json();
  assert.equal(body.quota.remaining, 10);
});

test("the period filters what a politician said", async () => {
  const { request } = await startTestApp();
  const all = await (await request(`/api/politician/${POLITICIANS[0]}`)).json();
  const january = await (await request(`/api/politician/${POLITICIANS[0]}?from=2025-01&to=2025-01`)).json();
  assert.equal(all.activity.speeches, 4);
  assert.equal(january.activity.speeches, 1);
  assert.deepEqual(january.period, { from: "2025-01", to: "2025-01" });
  assert.ok(all.words.distinctive["2"].some((row: { ngram: string }) => row.ngram === "justice fiscale"));
  assert.ok(!january.words.common["2"].some((row: { ngram: string }) => row.ngram === "justice fiscale"));
  assert.deepEqual(all.markers.markerRates, { address: 1.5, negation: 0.5 });
});

test("registration requires opening the emailed link", async () => {
  const { request, register, verify, db } = await startTestApp();
  for (const id of POLITICIANS.slice(0, 10)) {
    assert.equal((await request(`/api/politician/${id}`)).status, 200);
  }
  assert.equal((await request(`/api/politician/${POLITICIANS[10]}`)).status, 429);

  const registered = await register("user@example.org");
  const payload = await registered.json();
  assert.equal(registered.status, 200, JSON.stringify(payload));
  assert.equal(payload.checkEmail, true);
  assert.equal(payload.session, undefined);
  assert.match(payload.devLink, /\/api\/auth\/magic-link\/verify\?token=/);
  const users = () => (db.prepare(`SELECT COUNT(*) AS n FROM "user"`).get() as { n: number }).n;
  assert.equal(users(), 0, "the address is not stored before it is verified");
  assert.equal((await request(`/api/politician/${POLITICIANS[10]}`)).status, 429, "no access before verification");

  const verified = await verify(payload.devLink);
  assert.equal(verified.status, 302);
  assert.match(verified.headers.get("location") || "", /verifie=1/);
  assert.equal(users(), 1);

  const quota = await (await request("/api/quota")).json();
  assert.equal(quota.session.email, "user@example.org");
  const unlocked = await request(`/api/politician/${POLITICIANS[10]}`);
  assert.equal(unlocked.status, 200);
  assert.equal((await unlocked.json()).quota.unlimited, true);
});

test("the emailed link brings the visitor back to the view they were on", async () => {
  const { register, verify } = await startTestApp();
  const kept = await (await register("back@example.org", { returnTo: "?onglet=groupe&groupe=RN" })).json();
  const location = (await verify(kept.devLink)).headers.get("location") || "";
  assert.match(location, /\/\?onglet=groupe&groupe=RN&verifie=1$/);

  for (const [index, returnTo] of ["//evil.example", "https://evil.example/?a=1", "?a=<script>"].entries()) {
    const payload = await (await register(`elsewhere${index}@example.org`, { returnTo })).json();
    const callback = new URL(payload.devLink).searchParams.get("callbackURL");
    assert.equal(callback, "/?verifie=1", returnTo);
  }
});

test("register rejects bad origins, invalid and disposable emails", async () => {
  const { request, register } = await startTestApp();
  const noOrigin = await request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.org" }),
  });
  assert.equal(noOrigin.status, 403);
  assert.equal((await register("not-an-email")).status, 400);
  const disposable = await register("someone@yopmail.com");
  assert.equal(disposable.status, 400);
  assert.equal((await disposable.json()).error, "disposable_email");
});

test("the honeypot pretends to succeed without sending anything", async () => {
  const { register, db } = await startTestApp();
  const response = await register("robot@example.org", { website: "http://spam.example" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.checkEmail, true);
  assert.equal(payload.devLink, undefined);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM verification").get() as { n: number }).n, 0);
});

test("a second link for the same address waits for the cooldown", async () => {
  const { register } = await startTestApp();
  assert.equal((await register("patient@example.org")).status, 200);
  const again = await register("patient@example.org");
  assert.equal(again.status, 429);
  const payload = await again.json();
  assert.equal(payload.error, "resend_cooldown");
  assert.ok(payload.retryAfter > 0 && payload.retryAfter <= 60);
});

test("a verified user can delete their account", async () => {
  const { request, register, verify, db } = await startTestApp();
  const { devLink } = await (await register("leaving@example.org")).json();
  await verify(devLink);
  assert.equal((await (await request("/api/quota")).json()).session.email, "leaving@example.org");

  const denied = await request("/api/account/delete", { method: "POST" });
  assert.equal(denied.status, 403);
  const deleted = await request("/api/account/delete", { method: "POST", headers: { origin: ORIGIN } });
  assert.equal(deleted.status, 200);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM "user"`).get() as { n: number }).n, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM "session"`).get() as { n: number }).n, 0);
  assert.equal((await (await request("/api/quota")).json()).session, null);
});

test("the email export is gone and data files are not served", async () => {
  const { request } = await startTestApp();
  assert.equal((await request("/api/admin/emails", { headers: { authorization: "Bearer x" } })).status, 404);
  for (const path of ["/data/dashboard-data.json", "/data/dashboard-data.js", "/../package.json"]) {
    assert.equal((await request(path)).status, 404, path);
  }
});

test("terms and method pages are served", async () => {
  const { request } = await startTestApp();
  for (const path of ["/conditions", "/methode"]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
  }
  const terms = await (await request("/conditions")).text();
  assert.match(terms, /prévention des abus/);
  assert.doesNotMatch(terms, /recontact/);
});

test("the dashboard carries every element the access gate drives and says why the email is asked", async () => {
  const { request } = await startTestApp();
  const index = await (await request("/")).text();
  const gate = await (await request("/quota-gate.js")).text();
  const ids = [...new Set([...gate.matchAll(/\$\("([A-Za-z]+)"\)/g)].map((match) => match[1]))];
  assert.ok(ids.length > 15);
  for (const id of ids) {
    assert.match(index, new RegExp(`id="${id}"`), id);
  }
  assert.match(index, /usages abusifs/);
  assert.match(index, /href="\/conditions"/);
  assert.match(index, /name="website"/);
  assert.doesNotMatch(index, /recontact/);
});
