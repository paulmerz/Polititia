import assert from "node:assert/strict";
import test from "node:test";
import { openAnalytics } from "../src/analytics.ts";
import { sendFollowAlerts } from "../src/alerts.ts";
import { loadDashboardData } from "../src/data.ts";
import { MAX_FOLLOWS, unsubscribeToken } from "../src/follows.ts";
import type { OutgoingEmail } from "../src/mailer.ts";
import { ALICES, BOB } from "./analytics-fixture.ts";
import { ORIGIN, startTestApp } from "./helpers.ts";

const JSON_POST = { origin: ORIGIN, "content-type": "application/json" };

// Better Auth rate limits sign-ins per address.
let lastOctet = 20;
function ownIp() {
  lastOctet += 1;
  return { "x-forwarded-for": `203.0.113.${lastOctet}` };
}

function follow(request: (path: string, init?: RequestInit) => Promise<Response>, politicianId: string) {
  return request("/api/follows", { method: "POST", headers: JSON_POST, body: JSON.stringify({ politicianId }) });
}

test("following a deputy needs a verified account and a same-origin request", async () => {
  const { request, signIn } = (await startTestApp()).client(ownIp());
  assert.equal((await request("/api/follows")).status, 401);
  assert.equal((await follow(request, BOB)).status, 401);
  await signIn("reader@example.org");
  const foreign = await request("/api/follows", {
    method: "POST",
    headers: { ...JSON_POST, origin: "https://evil.example" },
    body: JSON.stringify({ politicianId: BOB }),
  });
  assert.equal(foreign.status, 403);
  assert.equal((await follow(request, "personne")).status, 404);

  const added = await (await follow(request, BOB)).json();
  assert.equal(added.added, true);
  assert.deepEqual(
    added.follows.map((item: { id: string; name: string; party: string }) => [item.id, item.name, item.party]),
    [[BOB, "M. Bob", "RN"]],
  );
  assert.equal((await (await follow(request, BOB)).json()).added, false, "following twice is harmless");

  const removed = await (await request(`/api/follows/${BOB}`, { method: "DELETE", headers: { origin: ORIGIN } })).json();
  assert.deepEqual(removed.follows, []);
});

test("an account follows at most MAX_FOLLOWS deputies", async () => {
  const { request, signIn } = (await startTestApp()).client(ownIp());
  await signIn("collector@example.org");
  for (const id of ALICES.slice(0, MAX_FOLLOWS)) {
    assert.equal((await follow(request, id)).status, 200);
  }
  const over = await follow(request, BOB);
  assert.equal(over.status, 400);
  assert.equal((await over.json()).error, "follow_limit");
});

test("alerts report what followed deputies said since the last one, then move on", async () => {
  const started = await startTestApp();
  const me = started.client(ownIp());
  await me.signIn("alerts@example.org");
  await follow(me.request, ALICES[0]);
  await follow(me.request, BOB);
  const analytics = openAnalytics(started.config.analyticsPath);
  assert.ok(analytics);
  const bundle = loadDashboardData(started.config.dashboardDataPath);
  const sent: OutgoingEmail[] = [];
  const send = async (_config: unknown, email: OutgoingEmail) => {
    sent.push(email);
  };

  const fresh = await sendFollowAlerts(started.config, started.db, analytics, bundle, { send, intervalMs: 0 });
  assert.equal(fresh.recipients, 0, "a new follow starts after the last day of the corpus");
  assert.equal(fresh.upToDate, 1);

  started.db.prepare("UPDATE follows SET notified_through = '2025-03-01'").run();
  const preview = await sendFollowAlerts(started.config, started.db, analytics, bundle, { dryRun: true, send, intervalMs: 0 });
  assert.equal(preview.recipients, 1);
  assert.deepEqual(preview.preview[0].deputies, ["Alice 0", "Bob"]);
  assert.equal(sent.length, 0, "a dry run sends nothing");

  const run = await sendFollowAlerts(started.config, started.db, analytics, bundle, { send, intervalMs: 0 });
  assert.equal(run.sent, 1);
  const [email] = sent;
  assert.equal(email.to, "alerts@example.org");
  assert.equal(email.subject, "Du nouveau pour 2 députés que vous suivez");
  assert.match(email.html, /Alice 0/);
  assert.match(email.html, /3 interventions en séance/);
  assert.match(email.html, new RegExp(`\\?depute=${ALICES[0]}`));
  assert.match(email.headers?.["List-Unsubscribe"] || "", /^<http:\/\/127\.0\.0\.1:8000\/desabonnement\?u=/);
  assert.equal(email.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(email.text || "", /Ne plus suivre : http/);

  const again = await sendFollowAlerts(started.config, started.db, analytics, bundle, { send, intervalMs: 0 });
  assert.equal(again.recipients, 0, "the same speeches are never reported twice");
});

test("the unsubscribe link asks for confirmation, then stops the alerts", async () => {
  const started = await startTestApp();
  const me = started.client(ownIp());
  await me.signIn("leaving@example.org");
  await follow(me.request, BOB);
  await follow(me.request, ALICES[0]);
  const { id: userId } = started.db.prepare(`SELECT id FROM "user" WHERE email = ?`).get("leaving@example.org") as { id: string };
  const anonymous = started.client(ownIp());

  const one = `/desabonnement?u=${userId}&p=${BOB}&t=${unsubscribeToken(started.config.secret, userId, BOB)}`;
  const page = await anonymous.request(one);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /M\. Bob[\s\S]*<form method="post"/);
  assert.equal((await (await me.request("/api/follows")).json()).follows.length, 2, "opening the link changes nothing");

  assert.equal((await anonymous.request(one, { method: "POST" })).status, 200);
  assert.deepEqual(
    (await (await me.request("/api/follows")).json()).follows.map((item: { id: string }) => item.id),
    [ALICES[0]],
  );

  const all = `/desabonnement?u=${userId}&t=${unsubscribeToken(started.config.secret, userId)}`;
  assert.equal((await anonymous.request(all, { method: "POST", body: "List-Unsubscribe=One-Click" })).status, 200);
  assert.deepEqual((await (await me.request("/api/follows")).json()).follows, []);

  const forged = await anonymous.request(`/desabonnement?u=${userId}&t=${"0".repeat(32)}`, { method: "POST" });
  assert.equal(forged.status, 400);
});

test("deleting the account deletes its follows", async () => {
  const started = await startTestApp();
  const me = started.client(ownIp());
  await me.signIn("gone@example.org");
  await follow(me.request, BOB);
  const deleted = await me.request("/api/account/delete", { method: "POST", headers: { origin: ORIGIN } });
  assert.equal(deleted.status, 200);
  assert.equal((started.db.prepare("SELECT COUNT(*) AS n FROM follows").get() as { n: number }).n, 0);
});

test("admins preview the next alerts and see the most followed deputies", async () => {
  const started = await startTestApp({}, { ADMIN_EMAILS: "boss@example.org" });
  const reader = started.client(ownIp());
  await reader.signIn("fan@example.org");
  await reader.request("/api/follows", { method: "POST", headers: JSON_POST, body: JSON.stringify({ politicianId: BOB }) });
  started.db.prepare("UPDATE follows SET notified_through = '2025-01-31'").run();

  const boss = started.client(ownIp());
  await boss.signIn("boss@example.org");
  const overview = await (await boss.request("/api/admin/alerts")).json();
  assert.equal(overview.follows, 1);
  assert.equal(overview.followers, 1);
  assert.deepEqual(overview.top, [{ name: "M. Bob", party: "RN", id: BOB, followers: 1 }]);
  assert.equal(overview.preview.recipients, 1);
  assert.match(overview.preview.preview[0].subject, /^Bob a pris la parole 3 fois depuis le 1er février$/);
  assert.equal(overview.hasMailer, false);

  const send = await boss.request("/api/admin/alerts/send", { method: "POST", headers: { origin: ORIGIN } });
  assert.equal(send.status, 400);
  assert.equal((await send.json()).error, "mailer_missing");
  assert.equal((await reader.request("/api/admin/alerts")).status, 403);
});
