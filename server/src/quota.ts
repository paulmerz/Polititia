import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "./store.ts";
import { DEVICE_COOKIE_NAME, REGISTER_MAX_PER_HOUR } from "./config.ts";
import { dayKey } from "./admin.ts";

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

export type ProxyTrust = { proxyHops: number; trustCloudflare: boolean };

// Proxies append the address they see to X-Forwarded-For, so only the last
// `proxyHops` entries are trustworthy: anything to their left was sent by the client.
export function clientIp(headers: Headers, trust: ProxyTrust, socketIp: string): string {
  if (trust.trustCloudflare) {
    const connecting = headers.get("cf-connecting-ip")?.trim();
    if (connecting) {
      return connecting.slice(0, 64);
    }
  } else if (trust.proxyHops > 0) {
    const forwarded = (headers.get("x-forwarded-for") || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwarded.length) {
      return forwarded[Math.max(0, forwarded.length - trust.proxyHops)].slice(0, 64);
    }
  }
  return socketIp;
}

export type ClientIpReport = {
  mode: "off" | "proxies" | "cloudflare";
  proxyHops: number;
  socketIp: string;
  // Left to right, as received: proxies append, so the rightmost entry is the closest proxy's view.
  forwardedFor: string[];
  cfConnectingIp: string | null;
  cfCountry: string | null;
  usedIp: string;
  // What TRUST_PROXY should be, assuming the request comes from a browser that adds no header itself.
  suggestion: { trustProxy: string; visitorIp: string; reason: string };
};

// Admin diagnostic: the headers a request arrived with and the address the server keeps.
export function describeClientIp(headers: Headers, trust: ProxyTrust, socketIp: string): ClientIpReport {
  const forwardedFor = (headers.get("x-forwarded-for") || "")
    .split(",")
    .map((part) => part.trim().slice(0, 64))
    .filter(Boolean)
    .slice(-20);
  const cfConnectingIp = headers.get("cf-connecting-ip")?.trim().slice(0, 64) || null;
  const cfCountry = headers.get("cf-ipcountry")?.trim().slice(0, 8) || null;
  let suggestion: ClientIpReport["suggestion"];
  if (!forwardedFor.length) {
    suggestion = {
      trustProxy: cfConnectingIp ? "cloudflare" : "0",
      visitorIp: cfConnectingIp || socketIp,
      reason: cfConnectingIp
        ? "Aucun X-Forwarded-For, mais un CF-Connecting-IP : seul Cloudflare se trouve devant le serveur."
        : "Aucun en-tête de proxy : le navigateur se connecte directement au serveur.",
    };
  } else {
    // A browser sends no X-Forwarded-For: every entry was added by a proxy, the first one is the visitor.
    const consistent = !cfConnectingIp || cfConnectingIp === forwardedFor[0];
    suggestion = {
      trustProxy: String(forwardedFor.length),
      visitorIp: forwardedFor[0],
      reason: consistent
        ? `${forwardedFor.length} proxy(s) ont ajouté une adresse à X-Forwarded-For ; la première est la vôtre.`
        : `${forwardedFor.length} proxy(s) dans X-Forwarded-For, mais CF-Connecting-IP (${cfConnectingIp}) ne correspond pas à la première entrée : vérifiez votre adresse avant de choisir.`,
    };
  }
  return {
    mode: trust.trustCloudflare ? "cloudflare" : trust.proxyHops > 0 ? "proxies" : "off",
    proxyHops: trust.proxyHops,
    socketIp,
    forwardedFor,
    cfConnectingIp,
    cfCountry,
    usedIp: clientIp(headers, trust, socketIp),
    suggestion,
  };
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
// One action loads at most the Assembly, a theme, a person and a group, in parallel.
export const INTERACTION_MAX_VIEWS = 4;
export const INTERACTION_WINDOW_MS = 30 * 1000;

export function isInteractionId(value: string | null | undefined): value is string {
  return Boolean(value && INTERACTION_ID_RE.test(value));
}

// One analysis = one user action. The requests an action sends at once share
// an interaction id: the first new view is counted, the next ones are free for
// a few seconds and a few views only, so an id cannot be replayed to read
// everything. Reopening a view already counted on this device (same person or
// theme, same period) is free too: it reveals no new data.
export function consumeInteraction(
  db: Store,
  secret: string,
  ip: string,
  deviceId: string,
  limit: number,
  keys: { interactionId?: string | null; view: string },
  nowMs = Date.now(),
): QuotaView & { allowed: boolean; counted: boolean } {
  const deviceHash = hashIdentity(secret, "device", deviceId);
  const viewKey = `v:${keys.view}`;
  const interactionId = isInteractionId(keys.interactionId) ? keys.interactionId : null;
  const now = new Date(nowMs).toISOString();
  const rememberView = db.prepare("INSERT OR IGNORE INTO quota_seen (device_hash, key, created_at) VALUES (?, ?, ?)");
  const free = () => {
    rememberView.run(deviceHash, viewKey, now);
    db.exec("COMMIT");
    return { ...readQuota(db, secret, ip, deviceId, limit), allowed: true, counted: false };
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM quota_seen WHERE device_hash = ? AND key = ?").get(deviceHash, viewKey)) {
      return free();
    }
    if (interactionId) {
      const joined = db
        .prepare(
          `UPDATE quota_interactions SET views = views + 1
           WHERE device_hash = ? AND interaction_id = ? AND created_at >= ? AND views < ?`,
        )
        .run(deviceHash, interactionId, new Date(nowMs - INTERACTION_WINDOW_MS).toISOString(), INTERACTION_MAX_VIEWS);
      if (Number(joined.changes) > 0) {
        return free();
      }
    }
    const ipCount = bumpCounter(db, "ip", hashIdentity(secret, "ip", ip));
    const deviceCount = bumpCounter(db, "device", deviceHash);
    const used = Math.max(ipCount, deviceCount);
    const allowed = used <= limit;
    if (allowed) {
      rememberView.run(deviceHash, viewKey, now);
      if (interactionId) {
        // An expired or full id keeps its row, so replaying it never opens a new window.
        db.prepare(
          `INSERT OR IGNORE INTO quota_interactions (device_hash, interaction_id, created_at, views)
           VALUES (?, ?, ?, 1)`,
        ).run(deviceHash, interactionId, now);
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

const DAY_SECONDS = 24 * 60 * 60;

// Fixed windows: a key counts its hits until `windowSeconds` after the first one.
function windowCount(db: Store, keyHash: string, windowSeconds: number, now: number): { count: number; resetIn: number } {
  const row = db.prepare("SELECT window_start, count FROM rate_windows WHERE key_hash = ?").get(keyHash) as
    | { window_start: number; count: number }
    | undefined;
  if (!row || now - Number(row.window_start) >= windowSeconds) {
    return { count: 0, resetIn: 0 };
  }
  return { count: Number(row.count), resetIn: windowSeconds - (now - Number(row.window_start)) };
}

function windowBump(db: Store, keyHash: string, windowSeconds: number, now: number): number {
  db.prepare(
    `INSERT INTO rate_windows (key_hash, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key_hash) DO UPDATE SET
       count = CASE WHEN ? - window_start >= ? THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`,
  ).run(keyHash, now, now, windowSeconds, now, windowSeconds, now);
  return windowCount(db, keyHash, windowSeconds, now).count;
}

// Seconds until this address may receive another link today (0 when it may).
export function emailDailyLimitSeconds(
  db: Store,
  secret: string,
  email: string,
  max: number,
  now = Math.floor(Date.now() / 1000),
): number {
  const { count, resetIn } = windowCount(db, hashIdentity(secret, "email-day", email), DAY_SECONDS, now);
  return count >= max ? resetIn : 0;
}

export type AccountLimits = { perMinute: number; perDay: number };

// Signed-in accounts have no analysis quota, only a ceiling against scraping.
export function accountRateLimited(
  db: Store,
  secret: string,
  userId: string,
  limits: AccountLimits,
  nowMs = Date.now(),
): boolean {
  const today = db.prepare("SELECT requests FROM user_usage WHERE user_id = ? AND day = ?").get(userId, dayKey(nowMs)) as
    | { requests: number }
    | undefined;
  if (Number(today?.requests || 0) >= limits.perDay) {
    return true;
  }
  const keyHash = hashIdentity(secret, "account-minute", userId);
  return windowBump(db, keyHash, 60, Math.floor(nowMs / 1000)) > limits.perMinute;
}

// Free routes that cost CPU (share images, commune search): a ceiling per address.
export function ipRateLimited(
  db: Store,
  secret: string,
  kind: string,
  ip: string,
  perMinute: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return windowBump(db, hashIdentity(secret, `${kind}-minute`, ip), 60, now) > perMinute;
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

export function recordEmailSend(db: Store, secret: string, email: string, now = Math.floor(Date.now() / 1000)): void {
  const keyHash = hashIdentity(secret, "email-send", email);
  db.prepare("INSERT OR REPLACE INTO email_sends (key_hash, last_sent) VALUES (?, ?)").run(keyHash, now);
  windowBump(db, hashIdentity(secret, "email-day", email), DAY_SECONDS, now);
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
