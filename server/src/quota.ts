import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "./store.ts";
import { DEVICE_COOKIE_NAME, REGISTER_MAX_PER_HOUR } from "./config.ts";

export type QuotaView = {
  limit: number;
  used: number;
  remaining: number;
  unlimited: boolean;
};

function hmacHex(secret: string, parts: string[]): string {
  const hmac = createHmac("sha256", secret);
  for (const part of parts) {
    hmac.update(part);
    hmac.update("\0");
  }
  return hmac.digest("hex");
}

export function hashIdentity(secret: string, kind: string, value: string): string {
  return hmacHex(secret, [kind, value]);
}

export function createDeviceId(): string {
  return randomBytes(16).toString("hex");
}

export function signDeviceId(secret: string, deviceId: string): string {
  return `${deviceId}.${hmacHex(secret, ["device-cookie", deviceId])}`;
}

export function parseDeviceCookie(secret: string, raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const deviceId = raw.slice(0, dot);
  const digest = raw.slice(dot + 1);
  if (!/^[a-f0-9]{32}$/i.test(deviceId) || !/^[a-f0-9]{64}$/i.test(digest)) {
    return null;
  }
  const expected = hmacHex(secret, ["device-cookie", deviceId]);
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  return deviceId;
}

export function clientIp(headers: Headers, trustProxy: boolean, fallback = "127.0.0.1"): string {
  if (trustProxy) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return first.slice(0, 64);
      }
    }
    const realIp = headers.get("x-real-ip")?.trim();
    if (realIp) {
      return realIp.slice(0, 64);
    }
  }
  return fallback;
}

function bumpCounter(db: Store, kind: string, keyHash: string): number {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO quota_counters (kind, key_hash, count, first_seen, last_seen)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(kind, key_hash) DO UPDATE SET
       count = count + 1,
       last_seen = excluded.last_seen`,
  ).run(kind, keyHash, now, now);
  const row = db.prepare("SELECT count FROM quota_counters WHERE kind = ? AND key_hash = ?").get(kind, keyHash) as
    | { count: number }
    | undefined;
  return Number(row?.count || 0);
}

function readCounter(db: Store, kind: string, keyHash: string): number {
  const row = db.prepare("SELECT count FROM quota_counters WHERE kind = ? AND key_hash = ?").get(kind, keyHash) as
    | { count: number }
    | undefined;
  return Number(row?.count || 0);
}

export function readQuota(db: Store, secret: string, ip: string, deviceId: string, limit: number): QuotaView {
  const ipCount = readCounter(db, "ip", hashIdentity(secret, "ip", ip));
  const deviceCount = readCounter(db, "device", hashIdentity(secret, "device", deviceId));
  const used = Math.max(ipCount, deviceCount);
  return {
    limit,
    used: Math.min(used, limit),
    remaining: Math.max(0, limit - used),
    unlimited: false,
  };
}

export function consumeQuota(
  db: Store,
  secret: string,
  ip: string,
  deviceId: string,
  limit: number,
): QuotaView & { allowed: boolean } {
  db.exec("BEGIN IMMEDIATE");
  try {
    const ipCount = bumpCounter(db, "ip", hashIdentity(secret, "ip", ip));
    const deviceCount = bumpCounter(db, "device", hashIdentity(secret, "device", deviceId));
    db.exec("COMMIT");
    const used = Math.max(ipCount, deviceCount);
    return {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      unlimited: false,
      allowed: used <= limit,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const INTERACTION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function isInteractionId(value: string | null | undefined): value is string {
  return Boolean(value && INTERACTION_ID_RE.test(value));
}

// One analysis = one user action. Several requests sent for the same action
// share an interaction id, and reopening a view already counted on this device
// (same person or theme, same period) is free: neither reveals new data.
export function consumeInteraction(
  db: Store,
  secret: string,
  ip: string,
  deviceId: string,
  limit: number,
  keys: { interactionId?: string | null; view: string },
): QuotaView & { allowed: boolean; counted: boolean } {
  const deviceHash = hashIdentity(secret, "device", deviceId);
  const seenKeys = [`v:${keys.view}`];
  if (isInteractionId(keys.interactionId)) {
    seenKeys.push(`i:${keys.interactionId}`);
  }
  const now = new Date().toISOString();
  const remember = db.prepare("INSERT OR IGNORE INTO quota_seen (device_hash, key, created_at) VALUES (?, ?, ?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    const seen = db
      .prepare(`SELECT 1 FROM quota_seen WHERE device_hash = ? AND key IN (${seenKeys.map(() => "?").join(",")}) LIMIT 1`)
      .get(deviceHash, ...seenKeys);
    if (seen) {
      for (const key of seenKeys) {
        remember.run(deviceHash, key, now);
      }
      db.exec("COMMIT");
      return { ...readQuota(db, secret, ip, deviceId, limit), allowed: true, counted: false };
    }
    const ipCount = bumpCounter(db, "ip", hashIdentity(secret, "ip", ip));
    const deviceCount = bumpCounter(db, "device", deviceHash);
    const used = Math.max(ipCount, deviceCount);
    const allowed = used <= limit;
    if (allowed) {
      for (const key of seenKeys) {
        remember.run(deviceHash, key, now);
      }
    }
    db.exec("COMMIT");
    return {
      limit,
      used: Math.min(used, limit),
      remaining: Math.max(0, limit - used),
      unlimited: false,
      allowed,
      counted: true,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function emailCooldownSeconds(db: Store, secret: string, email: string, cooldown: number): number {
  const keyHash = hashIdentity(secret, "email-send", email);
  const row = db.prepare("SELECT last_sent FROM email_sends WHERE key_hash = ?").get(keyHash) as
    | { last_sent: number }
    | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (row && now - Number(row.last_sent) < cooldown) {
    return cooldown - (now - Number(row.last_sent));
  }
  return 0;
}

export function recordEmailSend(db: Store, secret: string, email: string): void {
  const keyHash = hashIdentity(secret, "email-send", email);
  db.prepare("INSERT OR REPLACE INTO email_sends (key_hash, last_sent) VALUES (?, ?)").run(
    keyHash,
    Math.floor(Date.now() / 1000),
  );
}

export function registerRateLimited(db: Store, secret: string, ip: string): boolean {
  const keyHash = hashIdentity(secret, "register-ip", ip);
  const now = Math.floor(Date.now() / 1000);
  const window = 60 * 60;
  const row = db.prepare("SELECT window_start, count FROM auth_attempts WHERE key_hash = ?").get(keyHash) as
    | { window_start: number; count: number }
    | undefined;
  if (!row || now - Number(row.window_start) >= window) {
    db.prepare("INSERT OR REPLACE INTO auth_attempts (key_hash, window_start, count) VALUES (?, ?, 1)").run(
      keyHash,
      now,
    );
    return false;
  }
  if (Number(row.count) >= REGISTER_MAX_PER_HOUR) {
    return true;
  }
  db.prepare("UPDATE auth_attempts SET count = count + 1 WHERE key_hash = ?").run(keyHash);
  return false;
}

export function deviceCookieHeader(secret: string, deviceId: string, secure: boolean): string {
  const parts = [
    `${DEVICE_COOKIE_NAME}=${signDeviceId(secret, deviceId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=34560000",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export const unlimitedQuota: QuotaView = {
  limit: 0,
  used: 0,
  remaining: 0,
  unlimited: true,
};
