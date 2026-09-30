import assert from "node:assert/strict";
import test from "node:test";
import { openStore, purgeStale } from "../src/store.ts";
import {
  consumeInteraction,
  consumeQuota,
  createDeviceId,
  emailCooldownSeconds,
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

test("email sends are throttled per address", () => {
  const db = freshStore();
  assert.equal(emailCooldownSeconds(db, secret, "a@example.org", 60), 0);
  recordEmailSend(db, secret, "a@example.org");
  assert.ok(emailCooldownSeconds(db, secret, "a@example.org", 60) > 0);
  assert.equal(emailCooldownSeconds(db, secret, "b@example.org", 60), 0);
});

test("stale counters are purged after a year", () => {
  const db = freshStore();
  consumeQuota(db, secret, "5.5.5.5", "a".repeat(32), 10);
  purgeStale(db, Date.now() + 400 * 24 * 60 * 60 * 1000);
  assert.equal(readQuota(db, secret, "5.5.5.5", "a".repeat(32), 10).used, 0);
});
