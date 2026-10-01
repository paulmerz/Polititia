import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig } from "../src/config.ts";
import { ORIGIN, startTestApp } from "./helpers.ts";

const MAILER = {
  hasMailer: true,
  resendApiKey: "re_test_key",
  emailFrom: "Polititia <no-reply@polititia.test>",
};

type SentEmail = { from: string; to: string; subject: string; html: string };

function mockResend(t: TestContext, status = (_email: SentEmail) => 200) {
  const sent: SentEmail[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    const email = JSON.parse(String(init?.body)) as SentEmail;
    sent.push(email);
    return new Response("{}", { status: status(email) });
  });
  return sent;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function registerRequest(email: string, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify({ email }),
  };
}

test("a new user triggers one notification with their email and IP", async (t) => {
  const sent = mockResend(t);
  const { request } = await startTestApp(MAILER);

  const first = await request(
    "/api/register",
    registerRequest("New.User@Example.org", { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
  );
  assert.equal(first.status, 200, await first.text());

  const toPaul = () => sent.filter((email) => email.to === "paul@maj.digital");
  await waitFor(() => toPaul().length === 1);
  const [notification] = toPaul();
  assert.equal(notification.from, MAILER.emailFrom);
  assert.equal(notification.subject, "Nouvel utilisateur Polititia : new.user@example.org");
  assert.match(notification.html, /Email : new\.user@example\.org/);
  assert.match(notification.html, /Adresse IP : 203\.0\.113\.7</);

  const again = await request(
    "/api/register",
    registerRequest("new.user@example.org", { "x-forwarded-for": "198.51.100.2" }),
  );
  assert.equal(again.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(toPaul().length, 1, "an existing user signing in again is not a new user");
});

test("a failing notification does not block account creation", async (t) => {
  const sent = mockResend(t, (email) => (email.to === "paul@maj.digital" ? 500 : 200));
  t.mock.method(console, "error", () => {});
  const { request } = await startTestApp(MAILER);

  const response = await request("/api/register", registerRequest("resilient@example.org"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).session, true);
  await waitFor(() => sent.some((email) => email.to === "paul@maj.digital"));
});

test("the notification uses the socket address when the proxy is not trusted", async (t) => {
  const sent = mockResend(t);
  const { app } = await startTestApp({ ...MAILER, trustProxy: false });

  const response = await app.request(
    new Request(`${ORIGIN}/api/register`, registerRequest("direct@example.org", { "x-forwarded-for": "6.6.6.6" })),
    undefined,
    { incoming: { socket: { remoteAddress: "192.0.2.44" } } },
  );
  assert.equal(response.status, 200);

  await waitFor(() => sent.some((email) => email.to === "paul@maj.digital"));
  const notification = sent.find((email) => email.to === "paul@maj.digital");
  assert.match(notification?.html || "", /Adresse IP : 192\.0\.2\.44</);
  assert.doesNotMatch(notification?.html || "", /6\.6\.6\.6/);
});

test("the notification escapes HTML from forwarded headers", async (t) => {
  const sent = mockResend(t);
  const { request } = await startTestApp(MAILER);

  await request("/api/register", registerRequest("xss@example.org", { "x-forwarded-for": "<b>evil</b>" }));
  await waitFor(() => sent.some((email) => email.to === "paul@maj.digital"));
  const notification = sent.find((email) => email.to === "paul@maj.digital");
  assert.match(notification?.html || "", /Adresse IP : &lt;b&gt;evil&lt;\/b&gt;/);
});

test("SIGNUP_NOTIFY_EMAIL=off disables the notification", async (t) => {
  const sent = mockResend(t);
  const { request } = await startTestApp({ ...MAILER, signupNotifyEmail: "" });

  const response = await request("/api/register", registerRequest("quiet@example.org"));
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    sent.map((email) => email.to),
    ["quiet@example.org"],
    "only the magic link is sent",
  );
});

test("SIGNUP_NOTIFY_EMAIL defaults to paul@maj.digital and can be overridden or disabled", () => {
  const base = { NODE_ENV: "test", DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "polititia-config-")) };
  assert.equal(loadConfig(base).signupNotifyEmail, "paul@maj.digital");
  assert.equal(loadConfig({ ...base, SIGNUP_NOTIFY_EMAIL: "" }).signupNotifyEmail, "paul@maj.digital");
  assert.equal(loadConfig({ ...base, SIGNUP_NOTIFY_EMAIL: " Ops@Maj.Digital " }).signupNotifyEmail, "ops@maj.digital");
  assert.equal(loadConfig({ ...base, SIGNUP_NOTIFY_EMAIL: "off" }).signupNotifyEmail, "");
});
