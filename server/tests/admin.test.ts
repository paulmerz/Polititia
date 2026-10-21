import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dayKey } from "../src/admin.ts";
import { createGeoLocator, locationFromMmdb } from "../src/geo.ts";
import { purgeStale } from "../src/store.ts";
import { BOB } from "./analytics-fixture.ts";
import { ORIGIN, POLITICIANS, startTestApp } from "./helpers.ts";

const ADMIN = "admin@example.org";
// Better Auth rate-limits link verifications per IP across app instances, so
// every simulated browser gets its own address.
let lastOctet = 0;
function nextIp(): string {
  lastOctet += 1;
  return `203.0.113.${lastOctet}`;
}
function lyon() {
  return { "cf-connecting-ip": nextIp(), "cf-ipcountry": "FR", "cf-ipcity": "Lyon" };
}
function anywhere() {
  return { "cf-connecting-ip": nextIp() };
}
const BRUSSELS = { "cf-connecting-ip": "198.51.100.4", "cf-ipcountry": "BE", "cf-ipcity": "Bruxelles" };
const DASHBOARD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dashboard");

type Overview = {
  me: { email: string };
  geoSource: string | null;
  stats: Record<string, number>;
  users: Array<{
    id: string;
    email: string;
    blocked: boolean;
    isAdmin: boolean;
    lastSeen: string | null;
    requests: { today: number; last7: number; last30: number; total: number };
    places: Array<{ country: string; city: string; signIns: number; requests: number }>;
  }>;
  daily: Array<{ day: string; requests: number; users: number }>;
  countries: Array<{ country: string; users: number; requests: number }>;
  cities: Array<{ country: string; city: string; users: number; requests: number }>;
};

async function startAdminApp() {
  const started = await startTestApp({}, { ADMIN_EMAILS: ` ${ADMIN.toUpperCase()} , ops@example.org`, TRUST_PROXY: "cloudflare" });
  const admin = started.client(anywhere());
  await admin.signIn(ADMIN);

  async function overview(): Promise<Overview> {
    const response = await admin.request("/api/admin/overview");
    assert.equal(response.status, 200);
    return response.json();
  }

  async function act(email: string, action: "block" | "unblock") {
    const user = (await overview()).users.find((row) => row.email === email);
    assert.ok(user, email);
    return admin.request(`/api/admin/users/${user.id}/${action}`, { method: "POST", headers: { origin: ORIGIN } });
  }

  return { ...started, admin, overview, act };
}

test("the admin pages do not exist without ADMIN_EMAILS", async () => {
  const { request, signIn } = await startTestApp();
  await signIn("someone@example.org");
  for (const path of ["/admin", "/admin.js", "/api/admin/overview"]) {
    assert.equal((await request(path)).status, 404, path);
  }
  const write = await request("/api/admin/users/x/block", { method: "POST", headers: { origin: ORIGIN } });
  assert.equal(write.status, 404);
});

test("only the listed accounts open the admin", async () => {
  const { client, overview } = await startAdminApp();
  const visitor = client(anywhere());

  const page = await visitor.request("/admin");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");

  const anonymous = await visitor.request("/api/admin/overview");
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).auth.exposeMagicLink, true, "the login form knows how links are sent");

  await visitor.signIn("reader@example.org");
  const reader = await visitor.request("/api/admin/overview");
  assert.equal(reader.status, 403);
  assert.deepEqual(await reader.json(), { error: "not_admin", session: { email: "reader@example.org" } });

  const data = await overview();
  assert.equal(data.me.email, ADMIN, "ADMIN_EMAILS is trimmed and case-insensitive");
  assert.deepEqual(
    data.users.map((user) => [user.email, user.isAdmin]).sort(),
    [
      [ADMIN, true],
      ["reader@example.org", false],
    ],
  );
});

test("requests and connection places are counted per account", async () => {
  const { client, overview } = await startAdminApp();
  const user = client(lyon());
  await user.signIn("lyon@example.org");
  assert.equal((await user.request(`/api/politician/${POLITICIANS[0]}`)).status, 200);
  assert.equal((await user.request(`/api/politician/${BOB}`)).status, 200);
  assert.equal((await user.request("/api/assembly")).status, 200);
  assert.equal((await user.request("/api/assembly", { headers: BRUSSELS })).status, 200);
  assert.equal((await user.request("/api/quota")).status, 200, "only analyses are counted");

  const anonymous = client(anywhere());
  await anonymous.request("/api/party/LFI_NFP");
  await anonymous.request("/api/theme/fin-de-vie");

  const data = await overview();
  const row = data.users.find((item) => item.email === "lyon@example.org");
  assert.ok(row);
  assert.deepEqual(row.requests, { today: 4, last7: 4, last30: 4, total: 4 });
  assert.ok(row.lastSeen);
  assert.deepEqual(
    row.places.map((place) => [place.city, place.country, place.requests, place.signIns]),
    [
      ["Lyon", "FR", 3, 1],
      ["Bruxelles", "BE", 1, 0],
    ],
  );
  assert.equal(data.geoSource, "cloudflare");
  assert.deepEqual(
    data.countries.filter((item) => item.country).map((item) => [item.country, item.users, item.requests]),
    [
      ["FR", 1, 3],
      ["BE", 1, 1],
    ],
  );
  assert.deepEqual(data.cities.map((item) => item.city).sort(), ["Bruxelles", "Lyon"]);
  assert.equal(data.daily.length, 30);
  assert.deepEqual(data.daily.at(-1), { day: dayKey(Date.now()), requests: 4, users: 1 });
  assert.equal(data.stats.requestsToday, 4);
  assert.equal(data.stats.activeToday, 1);
  assert.equal(data.stats.anonymousDevices30, 1);
  assert.equal(data.stats.anonymousAnalyses30, 2);
});

test("signed-in accounts hit a per-minute ceiling, administrators do not", async () => {
  const started = await startTestApp(
    {},
    { ADMIN_EMAILS: ADMIN, TRUST_PROXY: "cloudflare", ACCOUNT_REQUESTS_PER_MINUTE: "3", ACCOUNT_REQUESTS_PER_DAY: "50" },
  );
  const user = started.client(anywhere());
  await user.signIn("busy@example.org");
  const statuses: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    statuses.push((await user.request("/api/assembly")).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 429]);
  const refused = await user.request("/api/assembly");
  assert.equal((await refused.json()).error, "account_rate_limited");
  const usage = started.db.prepare("SELECT SUM(requests) AS n FROM user_usage").get() as { n: number };
  assert.equal(usage.n, 3, "refused requests are not counted as served");

  const admin = started.client(anywhere());
  await admin.signIn(ADMIN);
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await admin.request("/api/assembly")).status, 200);
  }
});

test("blocking signs the account out at once and refuses new links until it is unblocked", async () => {
  const { client, act, overview, db } = await startAdminApp();
  const user = client(lyon());
  await user.signIn("blocked@example.org");
  assert.equal((await (await user.request("/api/quota")).json()).session.email, "blocked@example.org");

  db.exec("DELETE FROM email_sends");
  const pendingLink = (await (await user.register("blocked@example.org")).json()).devLink;
  assert.ok(pendingLink);

  const blocked = await act("blocked@example.org", "block");
  assert.equal(blocked.status, 200);
  assert.equal((await blocked.json()).blocked, true);

  const quota = await (await user.request("/api/quota")).json();
  assert.equal(quota.session, null, "the session cookie cache does not keep the account signed in");
  const analysis = await (await user.request(`/api/politician/${POLITICIANS[2]}`)).json();
  assert.equal(analysis.quota.unlimited, false, "the person falls back to the anonymous quota");
  const sessions = db
    .prepare(`SELECT COUNT(*) AS n FROM "session" s JOIN "user" u ON u.id = s."userId" WHERE u.email = ?`)
    .get("blocked@example.org") as { n: number };
  assert.equal(sessions.n, 0);

  const refused = await user.register("blocked@example.org");
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "account_blocked");
  const late = await user.verify(pendingLink);
  assert.match(late.headers.get("location") || "", /error=failed_to_create_session/);
  assert.equal((await (await user.request("/api/quota")).json()).session, null, "a link sent before the block is void");

  const row = (await overview()).users.find((item) => item.email === "blocked@example.org");
  assert.equal(row?.blocked, true);
  assert.equal((await overview()).stats.blocked, 1);

  assert.equal((await act("blocked@example.org", "unblock")).status, 200);
  db.exec("DELETE FROM email_sends");
  await user.signIn("blocked@example.org");
  assert.equal((await (await user.request("/api/quota")).json()).session.email, "blocked@example.org");
});

test("administrators cannot be blocked and admin writes check the origin", async () => {
  const { admin, client, overview } = await startAdminApp();
  const reader = client(anywhere());
  await reader.signIn("reader@example.org");
  const users = (await overview()).users;
  const self = users.find((user) => user.email === ADMIN);
  const other = users.find((user) => user.email === "reader@example.org");
  assert.ok(self && other);

  const selfBlock = await admin.request(`/api/admin/users/${self.id}/block`, { method: "POST", headers: { origin: ORIGIN } });
  assert.equal(selfBlock.status, 400);
  assert.equal((await selfBlock.json()).error, "cannot_block_admin");

  const noOrigin = await admin.request(`/api/admin/users/${other.id}/block`, { method: "POST" });
  assert.equal(noOrigin.status, 403);
  const foreign = await admin.request(`/api/admin/users/${other.id}/block`, {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(foreign.status, 403);
  const unknown = await admin.request("/api/admin/users/nobody/block", { method: "POST", headers: { origin: ORIGIN } });
  assert.equal(unknown.status, 404);
  const byReader = await reader.request(`/api/admin/users/${other.id}/block`, {
    method: "POST",
    headers: { origin: ORIGIN },
  });
  assert.equal(byReader.status, 403);
  assert.equal((await overview()).stats.blocked, 0);
});

test("deleting an account deletes its counters, places and block", async () => {
  const { client, db } = await startAdminApp();
  const user = client(lyon());
  await user.signIn("leaving@example.org");
  await user.request("/api/assembly");
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count("user_usage"), 1);
  assert.ok(count("user_locations") >= 2, "the admin and the user each have a place");

  const deleted = await user.request("/api/account/delete", { method: "POST", headers: { origin: ORIGIN } });
  assert.equal(deleted.status, 200);
  assert.equal(count("user_usage"), 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM user_locations WHERE city = 'Lyon'").get() as { n: number }).n,
    0,
  );
});

test("activity older than 12 months is purged", async () => {
  const { client, db } = await startAdminApp();
  const user = client(lyon());
  await user.signIn("old@example.org");
  await user.request("/api/assembly");
  const now = Date.now();
  const old = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE user_usage SET day = ?").run(old.slice(0, 10));
  db.prepare("UPDATE user_locations SET last_seen = ? WHERE city = 'Lyon'").run(old);
  purgeStale(db, now);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM user_usage").get() as { n: number }).n, 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM user_locations WHERE city = 'Lyon'").get() as { n: number }).n,
    0,
  );
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM "user"`).get() as { n: number }).n, 2, "accounts are kept");
});

test("the admin login link brings the administrator back to /admin", async () => {
  const { client, db } = await startAdminApp();
  const visitor = client(anywhere());
  db.exec("DELETE FROM email_sends");
  const payload = await (await visitor.register(ADMIN, { returnTo: "/admin" })).json();
  assert.equal(new URL(payload.devLink).searchParams.get("callbackURL"), "/admin");
  const landed = await visitor.verify(payload.devLink);
  assert.match(landed.headers.get("location") || "", /\/admin$/);
  assert.equal((await visitor.request("/api/admin/overview")).status, 200);
});

test("the IP diagnostic is for administrators and shows a forged address is ignored", async () => {
  const started = await startTestApp({}, { ADMIN_EMAILS: ADMIN, TRUST_PROXY: "2" });
  // Behind two proxies (Cloudflare, then Render), the browser sends no X-Forwarded-For of its own.
  const chain = "198.51.100.20, 172.71.0.5";
  const admin = started.client({ "x-forwarded-for": chain }, "10.0.0.2");
  await admin.signIn(ADMIN);
  const reader = started.client({ "x-forwarded-for": "198.51.100.21, 172.71.0.5" }, "10.0.0.2");
  assert.equal((await reader.request("/api/admin/ip-check")).status, 401);
  await reader.signIn("reader@example.org");
  assert.equal((await reader.request("/api/admin/ip-check")).status, 403);

  const honest = await (await admin.request("/api/admin/ip-check")).json();
  assert.equal(honest.mode, "proxies");
  assert.equal(honest.socketIp, "10.0.0.2");
  assert.deepEqual(honest.forwardedFor, ["198.51.100.20", "172.71.0.5"]);
  assert.equal(honest.usedIp, "198.51.100.20");
  assert.deepEqual(honest.suggestion, { ...honest.suggestion, trustProxy: "2", visitorIp: "198.51.100.20" });

  const forged = await (
    await admin.request("/api/admin/ip-check", { headers: { "x-forwarded-for": `203.0.113.7, ${chain}` } })
  ).json();
  assert.equal(forged.usedIp, "198.51.100.20", "the entry the browser added on the left is ignored");
});

test("in production, a request through an untrusted proxy is logged once", async (t) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (message: string) => warnings.push(String(message)));
  const started = await startTestApp({ isProduction: true, trustProxy: false, proxyHops: 0, trustCloudflare: false });
  for (let index = 0; index < 3; index += 1) {
    await started.request("/api/health", { headers: { "x-forwarded-for": `198.51.100.${index}` } });
  }
  assert.equal(warnings.filter((message) => message.includes("TRUST_PROXY is probably wrong")).length, 1);
});

test("the admin page carries every element its script drives", async () => {
  const html = readFileSync(path.join(DASHBOARD_DIR, "admin.html"), "utf8");
  const script = readFileSync(path.join(DASHBOARD_DIR, "admin.js"), "utf8");
  const ids = new Set([...script.matchAll(/\$\("([A-Za-z]+)"\)/g)].map((match) => match[1]));
  for (const match of script.matchAll(/\["([A-Za-z]+)", "([A-Za-z]+)", "([A-Za-z]+)"\]/g)) {
    match.slice(1).forEach((id) => ids.add(id));
  }
  for (const match of script.matchAll(/geoRows\("([A-Za-z]+)"/g)) {
    ids.add(match[1]);
  }
  assert.ok(ids.size > 20);
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(script, /innerHTML/, "user data is only written as text");
  assert.doesNotMatch(html, /style=/, "the CSP forbids inline styles");
});

test("Cloudflare location headers are only trusted with TRUST_PROXY=cloudflare", () => {
  const headers = new Headers({ "cf-ipcountry": "fr", "cf-ipcity": Buffer.from("Besançon").toString("latin1") });
  const trusted = createGeoLocator({ geoipPath: "/nonexistent.mmdb", trustCloudflare: true });
  assert.deepEqual(trusted.locate("203.0.113.1", headers), { country: "FR", city: "Besançon" });
  assert.deepEqual(trusted.locate("203.0.113.1", new Headers({ "cf-ipcountry": "XX" })), { country: "", city: "" });
  assert.deepEqual(trusted.locate("203.0.113.1", new Headers({ "cf-ipcountry": "T1" })), { country: "", city: "" });

  const direct = createGeoLocator({ geoipPath: "/nonexistent.mmdb", trustCloudflare: false });
  assert.deepEqual(direct.locate("203.0.113.1", headers), { country: "", city: "" });
  assert.equal(direct.source(), null);
});

test("MMDB records map to a country code and a city name", () => {
  assert.deepEqual(locationFromMmdb({ country: { iso_code: "BE" }, city: { names: { en: "Brussels", fr: "Bruxelles" } } }), {
    country: "BE",
    city: "Bruxelles",
  });
  assert.deepEqual(locationFromMmdb({ registered_country: { iso_code: "de" } }), { country: "DE", city: "" });
  assert.deepEqual(locationFromMmdb(null), { country: "", city: "" });
});
