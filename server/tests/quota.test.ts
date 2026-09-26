import assert from "node:assert/strict";
import test from "node:test";
import { openStore } from "../src/store.ts";
import { consumeQuota, createDeviceId, parseDeviceCookie, readQuota, signDeviceId } from "../src/quota.ts";
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
