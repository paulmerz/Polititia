import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { ORIGIN, startTestApp } from "./helpers.ts";

const MAILER = {
  hasMailer: true,
  resendApiKey: "re_test_key",
  emailFrom: "Polititia <no-reply@polititia.test>",
};

type SentEmail = { from: string; to: string; subject: string; html: string };
type NodeEnv = { incoming: { socket: { remoteAddress: string } } };

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

async function startNotifyingApp(t: TestContext, overrides: Partial<AppConfig> = {}, status?: (email: SentEmail) => number) {
  const sent = mockResend(t, status);
  const started = await startTestApp({ ...MAILER, ...overrides });

  // The account is only created when the emailed link is opened, so the
  // notification carries the address of the request that opens it.
  async function signUp(email: string, headers: Record<string, string> = {}, env?: NodeEnv) {
    const registered = await started.app.request(
      new Request(`${ORIGIN}/api/register`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(registered.status, 200, await registered.text());
    const link = sent.findLast((message) => message.to === email.toLowerCase())?.html.match(/href="([^"]+)"/)?.[1];
    assert.ok(link, "the magic link is emailed");
    const url = new URL(link.replaceAll("&amp;", "&"));
    return started.app.request(
      new Request(`${ORIGIN}${url.pathname}${url.search}`, { headers, redirect: "manual" }),
      undefined,
      env,
    );
  }

  const toPaul = () => sent.filter((message) => message.to === "paul@maj.digital");
  return { ...started, sent, signUp, toPaul };
}

test("a new user triggers one notification with their email and IP", async (t) => {
  const { signUp, toPaul, db } = await startNotifyingApp(t);

  const first = await signUp("New.User@Example.org", { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  assert.equal(first.status, 302);

  await waitFor(() => toPaul().length === 1);
  const [notification] = toPaul();
  assert.equal(notification.from, MAILER.emailFrom);
  assert.equal(notification.subject, "Nouvel utilisateur Polititia : new.user@example.org");
  assert.match(notification.html, /Email : new\.user@example\.org/);
  assert.match(notification.html, /Adresse IP : 203\.0\.113\.7</);

  db.exec("DELETE FROM email_sends");
  const again = await signUp("new.user@example.org", { "x-forwarded-for": "198.51.100.2" });
  assert.equal(again.status, 302);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(toPaul().length, 1, "an existing user signing in again is not a new user");
});

test("a failing notification does not block account creation", async (t) => {
  t.mock.method(console, "error", () => {});
  const { signUp, toPaul, db } = await startNotifyingApp(t, {}, (email) => (email.to === "paul@maj.digital" ? 500 : 200));

  const response = await signUp("resilient@example.org");
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") || "", /verifie=1/);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM "user"`).get() as { n: number }).n, 1);
  await waitFor(() => toPaul().length === 1);
});

test("the notification uses the socket address when the proxy is not trusted", async (t) => {
  const { signUp, toPaul } = await startNotifyingApp(t, { trustProxy: false });

  const response = await signUp(
    "direct@example.org",
    { "x-forwarded-for": "6.6.6.6" },
    { incoming: { socket: { remoteAddress: "192.0.2.44" } } },
  );
  assert.equal(response.status, 302);

  await waitFor(() => toPaul().length === 1);
  const [notification] = toPaul();
  assert.match(notification.html, /Adresse IP : 192\.0\.2\.44</);
  assert.doesNotMatch(notification.html, /6\.6\.6\.6/);
});

test("the notification escapes HTML from forwarded headers", async (t) => {
  const { signUp, toPaul } = await startNotifyingApp(t);

  await signUp("xss@example.org", { "x-forwarded-for": "<b>evil</b>" });
  await waitFor(() => toPaul().length === 1);
  const [notification] = toPaul();
  assert.match(notification.html, /Adresse IP : &lt;b&gt;evil&lt;\/b&gt;/);
});

test("SIGNUP_NOTIFY_EMAIL=off disables the notification", async (t) => {
  const { signUp, sent } = await startNotifyingApp(t, { signupNotifyEmail: "" });

  const response = await signUp("quiet@example.org");
  assert.equal(response.status, 302);
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
