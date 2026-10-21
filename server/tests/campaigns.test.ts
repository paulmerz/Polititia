import assert from "node:assert/strict";
import test from "node:test";
import { campaignOf } from "../src/campaigns.ts";
import { purgeStale } from "../src/store.ts";
import { BOB } from "./analytics-fixture.ts";
import { startTestApp } from "./helpers.ts";

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

let lastOctet = 120;
function visitor(agent = BROWSER) {
  lastOctet += 1;
  return { "x-forwarded-for": `203.0.113.${lastOctet}`, "user-agent": agent };
}

test("campaign tags are cleaned and optional", () => {
  assert.deepEqual(campaignOf(new URLSearchParams("utm_source=Député &utm_medium=e-mail&utm_campaign=PQR 33")), {
    source: "depute",
    medium: "e-mail",
    campaign: "pqr-33",
  });
  assert.equal(campaignOf(new URLSearchParams("depute=x&utm_medium=email")), null, "a medium alone says nothing");
  assert.equal(campaignOf(new URLSearchParams(`utm_source=${"a".repeat(500)}`))?.source.length, 60);
});

test("tagged visits are counted per day without anything about the visitor", async () => {
  const started = await startTestApp({}, { ADMIN_EMAILS: "boss@example.org" });
  const link = `/?depute=${BOB}&utm_source=depute&utm_medium=email&utm_campaign=lancement-deputes`;
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await started.client(visitor()).request(link)).status, 200);
  }
  await started.client(visitor("WhatsApp/2.24.1 A")).request(link);
  await started.client(visitor()).request(link, { headers: { "sec-purpose": "prefetch" } });
  await started.client(visitor()).request(`/?depute=${BOB}`);

  const rows = started.db.prepare("SELECT * FROM campaign_visits").all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1, "link previews, prefetches and untagged visits are not counted");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["campaign", "day", "medium", "source", "visits"]);
  assert.equal(rows[0].visits, 3);

  const repeat = started.client(visitor());
  for (let index = 0; index < 15; index += 1) {
    await repeat.request(link);
  }
  const visits = (started.db.prepare("SELECT SUM(visits) AS n FROM campaign_visits").get() as { n: number }).n;
  assert.equal(visits, 13, "one address replaying the link counts 10 times a minute at most");

  const boss = started.client(visitor());
  await boss.signIn("boss@example.org");
  const report = await (await boss.request("/api/admin/campaigns")).json();
  assert.equal(report.total, 13);
  assert.deepEqual(report.sources, [{ source: "depute", visits: 13 }]);
  assert.equal(report.campaigns[0].campaign, "lancement-deputes");
  assert.equal(report.campaigns[0].last7, 13);
  assert.equal((await started.client(visitor()).request("/api/admin/campaigns")).status, 401);

  started.db.prepare("UPDATE campaign_visits SET day = '2020-01-01'").run();
  purgeStale(started.db);
  assert.equal(started.db.prepare("SELECT COUNT(*) AS n FROM campaign_visits").get()?.n, 0, "kept two years");
});
