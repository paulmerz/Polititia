import assert from "node:assert/strict";
import test from "node:test";
import { openStore, purgeStale } from "../src/store.ts";
import { dayKey } from "../src/admin.ts";
import {
  accountRateLimited,
  clientIp,
  consumeInteraction,
  INTERACTION_MAX_VIEWS,
  INTERACTION_WINDOW_MS,
  consumeQuota,
  createDeviceId,
  describeClientIp,
  emailCooldownSeconds,
  emailDailyLimitSeconds,
  parseDeviceCookie,
  readQuota,
  recordEmailSend,
  signDeviceId,
} from "../src/quota.ts";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const secret = "quota-secret-quota-secret-quota-secret";

test("device cookie is signed and rejected if tampered", () => {
  const deviceId = createDeviceId();
  const cookie = signDeviceId(secret, deviceId);
  assert.equal(parseDeviceCookie(secret, cookie), deviceId);
  assert.equal(parseDeviceCookie(secret, cookie.replace(/[0-9a-f]$/i, "0")), null);
  assert.equal(parseDeviceCookie(secret, deviceId), null);
});

test("quota uses the max of IP and cookie counters", () => {
  const db = openStore(path.join(mkdtempSync(path.join(os.tmpdir(), "quota-")), "q.sqlite"));
  const ip = "1.1.1.1";
  const deviceA = "a".repeat(32);
  const deviceB = "b".repeat(32);

  for (let index = 0; index < 10; index += 1) {
    const result = consumeQuota(db, secret, ip, deviceA, 10);
    assert.equal(result.allowed, true);
    assert.equal(result.used, index + 1);
  }
  const blockedSamePair = consumeQuota(db, secret, ip, deviceA, 10);
  assert.equal(blockedSamePair.allowed, false);

  const blockedNewCookie = consumeQuota(db, secret, ip, deviceB, 10);
  assert.equal(blockedNewCookie.allowed, false, "same IP with a new cookie stays blocked");

  const otherIp = consumeQuota(db, secret, "8.8.8.8", deviceA, 10);
  assert.equal(otherIp.allowed, false, "same cookie on a new IP stays blocked");

  const fresh = consumeQuota(db, secret, "9.9.9.9", "c".repeat(32), 10);
  assert.equal(fresh.allowed, true);
  assert.equal(readQuota(db, secret, "9.9.9.9", "c".repeat(32), 10).used, 1);
});

function freshStore() {
  return openStore(path.join(mkdtempSync(path.join(os.tmpdir(), "quota-")), "q.sqlite"));
}

test("one interaction id counts once across several views", () => {
  const db = freshStore();
  const device = "d".repeat(32);
  const first = consumeInteraction(db, secret, "2.2.2.2", device, 10, { interactionId: "action-00000001", view: "assembly::2025-01:2025-02" });
  const second = consumeInteraction(db, secret, "2.2.2.2", device, 10, { interactionId: "action-00000001", view: "politician:x::2025-01:2025-02" });
  assert.equal(first.counted, true);
  assert.equal(second.counted, false);
  assert.equal(second.used, 1);
});

test("a view counted once is free afterwards, even past the limit", () => {
  const db = freshStore();
  const device = "e".repeat(32);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(consumeInteraction(db, secret, "3.3.3.3", device, 3, { view: `politician:${index}` }).allowed, true);
  }
  const blocked = consumeInteraction(db, secret, "3.3.3.3", device, 3, { view: "politician:new" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(consumeInteraction(db, secret, "3.3.3.3", device, 3, { view: "politician:1" }).allowed, true);
  const stillBlocked = consumeInteraction(db, secret, "3.3.3.3", device, 3, { view: "politician:new" });
  assert.equal(stillBlocked.allowed, false, "a denied view is not remembered as free");
});

test("malformed interaction ids are ignored", () => {
  const db = freshStore();
  const device = "f".repeat(32);
  consumeInteraction(db, secret, "4.4.4.4", device, 10, { interactionId: "x", view: "a" });
  const second = consumeInteraction(db, secret, "4.4.4.4", device, 10, { interactionId: "x", view: "b" });
  assert.equal(second.counted, true);
});

test("an interaction id covers a few views only, and replaying it never reopens it", () => {
  const db = freshStore();
  const device = "1".repeat(32);
  const interactionId = "replayed-0000001";
  const counted = (index: number) =>
    consumeInteraction(db, secret, "6.6.6.6", device, 100, { interactionId, view: `politician:${index}` }).counted;
  assert.equal(counted(0), true);
  for (let index = 1; index < INTERACTION_MAX_VIEWS; index += 1) {
    assert.equal(counted(index), false, `view ${index} belongs to the same action`);
  }
  for (let index = INTERACTION_MAX_VIEWS; index < INTERACTION_MAX_VIEWS + 5; index += 1) {
    assert.equal(counted(index), true, `view ${index} is past the action`);
  }
  assert.equal(readQuota(db, secret, "6.6.6.6", device, 100).used, 6);
});

test("an interaction id expires after a few seconds", () => {
  const db = freshStore();
  const device = "2".repeat(32);
  const start = Date.now();
  const consume = (view: string, at: number) =>
    consumeInteraction(db, secret, "7.7.7.7", device, 100, { interactionId: "late-action-0001", view }, at).counted;
  assert.equal(consume("a", start), true);
  assert.equal(consume("b", start + 1000), false);
  assert.equal(consume("c", start + INTERACTION_WINDOW_MS + 1000), true);
  assert.equal(consume("d", start + INTERACTION_WINDOW_MS + 2000), true, "a late request does not open a new window");
});

test("reopening a counted view does not lend its interaction id to new views", () => {
  const db = freshStore();
  const device = "3".repeat(32);
  assert.equal(consumeInteraction(db, secret, "8.8.4.4", device, 100, { interactionId: "first-action-01", view: "a" }).counted, true);
  assert.equal(consumeInteraction(db, secret, "8.8.4.4", device, 100, { interactionId: "reopen-action-1", view: "a" }).counted, false);
  assert.equal(consumeInteraction(db, secret, "8.8.4.4", device, 100, { interactionId: "reopen-action-1", view: "b" }).counted, true);
});

test("the client address comes from the trusted end of X-Forwarded-For", () => {
  const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.5, 10.0.0.2", "cf-connecting-ip": "198.51.100.9" });
  assert.equal(clientIp(headers, { proxyHops: 0, trustCloudflare: false }, "192.0.2.1"), "192.0.2.1");
  assert.equal(clientIp(headers, { proxyHops: 1, trustCloudflare: false }, "192.0.2.1"), "10.0.0.2");
  assert.equal(clientIp(headers, { proxyHops: 2, trustCloudflare: false }, "192.0.2.1"), "203.0.113.5");
  assert.equal(clientIp(headers, { proxyHops: 5, trustCloudflare: false }, "192.0.2.1"), "6.6.6.6");
  assert.equal(clientIp(new Headers(), { proxyHops: 1, trustCloudflare: false }, "192.0.2.1"), "192.0.2.1");
  assert.equal(clientIp(headers, { proxyHops: 0, trustCloudflare: true }, "192.0.2.1"), "198.51.100.9");
  assert.equal(clientIp(new Headers(), { proxyHops: 0, trustCloudflare: true }, "192.0.2.1"), "192.0.2.1");
});

test("the IP diagnostic suggests the number of proxies that wrote X-Forwarded-For", () => {
  const off = { proxyHops: 0, trustCloudflare: false };
  const render = new Headers({ "x-forwarded-for": "198.51.100.9, 172.71.0.5", "cf-connecting-ip": "198.51.100.9" });
  const report = describeClientIp(render, off, "10.0.0.2");
  assert.equal(report.mode, "off");
  assert.equal(report.usedIp, "10.0.0.2", "with TRUST_PROXY=0 every visitor is the proxy");
  assert.deepEqual(report.suggestion.trustProxy, "2");
  assert.equal(report.suggestion.visitorIp, "198.51.100.9");
  assert.equal(describeClientIp(render, { proxyHops: 2, trustCloudflare: false }, "10.0.0.2").usedIp, "198.51.100.9");

  const direct = describeClientIp(new Headers(), off, "192.0.2.8");
  assert.deepEqual([direct.suggestion.trustProxy, direct.suggestion.visitorIp], ["0", "192.0.2.8"]);
  const cloudflareOnly = describeClientIp(new Headers({ "cf-connecting-ip": "198.51.100.3" }), off, "172.68.0.1");
  assert.deepEqual([cloudflareOnly.suggestion.trustProxy, cloudflareOnly.suggestion.visitorIp], ["cloudflare", "198.51.100.3"]);
  const mismatch = describeClientIp(new Headers({ "x-forwarded-for": "198.51.100.9", "cf-connecting-ip": "203.0.113.1" }), off, "10.0.0.2");
  assert.match(mismatch.suggestion.reason, /ne correspond pas/);
});

test("email sends are throttled per address", () => {
  const db = freshStore();
  assert.equal(emailCooldownSeconds(db, secret, "a@example.org", 60), 0);
  recordEmailSend(db, secret, "a@example.org");
  assert.ok(emailCooldownSeconds(db, secret, "a@example.org", 60) > 0);
  assert.equal(emailCooldownSeconds(db, secret, "b@example.org", 60), 0);
});

test("an address receives a limited number of links per day, then the window reopens", () => {
  const db = freshStore();
  const start = 1_800_000_000;
  for (let index = 0; index < 5; index += 1) {
    assert.equal(emailDailyLimitSeconds(db, secret, "a@example.org", 5, start + index), 0);
    recordEmailSend(db, secret, "a@example.org", start + index);
  }
  assert.equal(emailDailyLimitSeconds(db, secret, "a@example.org", 5, start + 10), 24 * 60 * 60 - 10);
  assert.equal(emailDailyLimitSeconds(db, secret, "b@example.org", 5, start + 10), 0);
  assert.equal(emailDailyLimitSeconds(db, secret, "a@example.org", 5, start + 24 * 60 * 60), 0);
  recordEmailSend(db, secret, "a@example.org", start + 24 * 60 * 60);
  assert.equal(emailDailyLimitSeconds(db, secret, "a@example.org", 5, start + 24 * 60 * 60 + 1), 0, "a new day starts from 1");
});

test("signed-in accounts are limited per minute and per day", () => {
  const db = freshStore();
  db.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" (id) VALUES ('u1'), ('u2')`);
  const limits = { perMinute: 3, perDay: 5 };
  const start = Date.parse("2026-03-10T10:00:00Z");
  const limited = (userId: string, at: number) => accountRateLimited(db, secret, userId, limits, at);
  assert.deepEqual([0, 1, 2, 3].map((index) => limited("u1", start + index)), [false, false, false, true]);
  assert.equal(limited("u2", start), false, "each account has its own window");
  assert.equal(limited("u1", start + 61_000), false, "the next minute reopens");

  db.prepare("INSERT INTO user_usage (user_id, day, requests) VALUES (?, ?, ?)").run("u2", dayKey(start), 5);
  assert.equal(limited("u2", start + 120_000), true, "the daily ceiling holds whatever the minute");
  assert.equal(limited("u2", start + 24 * 60 * 60 * 1000), false, "and resets the next day");
});

test("stale counters are purged after a year", () => {
  const db = freshStore();
  consumeQuota(db, secret, "5.5.5.5", "a".repeat(32), 10);
  purgeStale(db, Date.now() + 400 * 24 * 60 * 60 * 1000);
  assert.equal(readQuota(db, secret, "5.5.5.5", "a".repeat(32), 10).used, 0);
});
