import assert from "node:assert/strict";
import test from "node:test";
import { parseReport } from "../src/reports.ts";
import { purgeStale } from "../src/store.ts";
import { BOB } from "./analytics-fixture.ts";
import { ORIGIN, startTestApp } from "./helpers.ts";

const MAILER = { hasMailer: true, resendApiKey: "re_test_key", emailFrom: "Polititia <no-reply@polititia.test>" };
const MESSAGE = "Cette citation n'est pas de ce député.";

let lastOctet = 10;
function visitor() {
  lastOctet += 1;
  return { "x-forwarded-for": `198.51.100.${lastOctet}` };
}

function post(body: Record<string, unknown>, origin = ORIGIN): RequestInit {
  return { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) };
}

test("a report needs a real message, and the page link is optional", () => {
  assert.deepEqual(parseReport({ subject: `depute:${BOB}`, page: `?depute=${BOB}`, message: `  ${MESSAGE} `, email: " Ana@Example.org " }), {
    subject: `depute:${BOB}`,
    page: `?depute=${BOB}`,
    message: MESSAGE,
    email: "ana@example.org",
  });
  assert.deepEqual(parseReport({ subject: "accueil", page: "?a=<script>", message: MESSAGE }), {
    subject: "accueil",
    page: "",
    message: MESSAGE,
    email: null,
  }, "an odd page is dropped, not the report");
  assert.deepEqual(parseReport({ message: "faux" }), { error: "invalid_message" });
  assert.deepEqual(parseReport({ message: MESSAGE, email: "pas-une-adresse" }), { error: "invalid_email" });
  assert.deepEqual(parseReport({ subject: "admin:1", message: MESSAGE }), { error: "invalid_subject" });
});

test("anyone can report an error, the admins are emailed and close it from /admin", async (t) => {
  const sent: Array<{ to: string; subject: string; html: string; headers?: Record<string, string> }> = [];
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  });
  const started = await startTestApp(MAILER, { ADMIN_EMAILS: "boss@example.org" });
  const reader = started.client(visitor());

  const body = { subject: `depute:${BOB}`, page: `?depute=${BOB}`, message: MESSAGE, email: "ana@example.org" };
  assert.equal((await reader.request("/api/reports", post(body, "https://evil.example"))).status, 403);
  assert.equal((await reader.request("/api/reports", post({ ...body, message: "non" }))).status, 400);
  const accepted = await reader.request("/api/reports", post(body));
  assert.equal(accepted.status, 200);
  const { id } = await accepted.json();

  await new Promise((resolve) => setTimeout(resolve, 20));
  const toBoss = sent.filter((email) => email.to === "boss@example.org" && email.subject.startsWith("Signalement"));
  assert.equal(toBoss.length, 1);
  assert.match(toBoss[0].subject, /Bob/i, "the subject names the deputy, not his id");
  assert.match(toBoss[0].html, /Cette citation n&#39;est pas de ce député/);
  assert.equal(toBoss[0].headers?.["Reply-To"], "ana@example.org");

  const robot = started.client(visitor());
  assert.equal((await robot.request("/api/reports", post({ ...body, website: "http://spam.example" }))).status, 200);
  assert.equal(started.db.prepare("SELECT COUNT(*) AS n FROM error_reports").get()?.n, 1, "the honeypot stores nothing");

  const boss = started.client(visitor());
  await boss.signIn("boss@example.org");
  const list = await (await boss.request("/api/admin/reports")).json();
  assert.equal(list.open.length, 1);
  assert.equal(list.open[0].id, id);
  assert.match(list.open[0].label, /Bob/i);
  assert.equal((await reader.request("/api/admin/reports")).status, 401);

  assert.equal((await boss.request(`/api/admin/reports/${id}/close`, post({}))).status, 200);
  assert.equal((await boss.request(`/api/admin/reports/${id}/close`, post({}))).status, 404, "already closed");
  const after = await (await boss.request("/api/admin/reports")).json();
  assert.equal(after.open.length, 0);
  assert.equal(after.done[0].handledBy, "boss@example.org");

  started.db.prepare("UPDATE error_reports SET created_at = '2020-01-01T00:00:00.000Z'").run();
  purgeStale(started.db);
  assert.equal(started.db.prepare("SELECT COUNT(*) AS n FROM error_reports").get()?.n, 0, "kept 12 months");
});

test("one address cannot flood the reports", async () => {
  const started = await startTestApp();
  const flooder = started.client(visitor());
  const statuses = [];
  for (let index = 0; index < 7; index += 1) {
    statuses.push((await flooder.request("/api/reports", post({ message: `${MESSAGE} ${index}` }))).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});
