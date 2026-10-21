import type { Store } from "./store.ts";
import type { GeoLocation } from "./geo.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAILY_SERIES_DAYS = 30;
const TOP_CITIES = 20;
const LOCATIONS_PER_USER = 3;

// Days are counted in the publisher's time zone, so "today" matches the admin's.
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKey(time: number): string {
  return DAY_FORMAT.format(new Date(time));
}

export function isBlocked(db: Store, userId: string | undefined | null): boolean {
  if (!userId) {
    return false;
  }
  return Boolean(db.prepare("SELECT 1 FROM user_blocks WHERE user_id = ?").get(userId));
}

export function isBlockedEmail(db: Store, email: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM "user" u JOIN user_blocks b ON b.user_id = u.id WHERE u.email = ?`)
      .get(email),
  );
}

export type AdminUserRef = { id: string; email: string };

export function findUser(db: Store, userId: string): AdminUserRef | null {
  const row = db.prepare(`SELECT id, email FROM "user" WHERE id = ?`).get(userId) as AdminUserRef | undefined;
  return row ? { id: String(row.id), email: String(row.email) } : null;
}

// Sessions are deleted so the account loses access at once; the session
// cookie cache is covered by isBlocked() on every request.
export function blockUser(db: Store, userId: string, blockedBy: string, now = Date.now()): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO user_blocks (user_id, blocked_at, blocked_by) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    ).run(userId, new Date(now).toISOString(), blockedBy);
    db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).run(userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function unblockUser(db: Store, userId: string): void {
  db.prepare("DELETE FROM user_blocks WHERE user_id = ?").run(userId);
}

export function recordActivity(
  db: Store,
  userId: string,
  location: GeoLocation,
  kind: "sign_in" | "request",
  now = Date.now(),
): void {
  const stamp = new Date(now).toISOString();
  const signIns = kind === "sign_in" ? 1 : 0;
  const requests = kind === "request" ? 1 : 0;
  if (requests) {
    db.prepare(
      `INSERT INTO user_usage (user_id, day, requests) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + 1`,
    ).run(userId, dayKey(now));
  }
  db.prepare(
    `INSERT INTO user_locations (user_id, country, city, sign_ins, requests, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, country, city) DO UPDATE SET
       sign_ins = sign_ins + excluded.sign_ins,
       requests = requests + excluded.requests,
       last_seen = excluded.last_seen`,
  ).run(userId, location.country, location.city, signIns, requests, stamp, stamp);
}

type UserRow = {
  id: string;
  email: string;
  createdAt: string | number;
  blockedAt: string | null;
  today: number | null;
  last7: number | null;
  last30: number | null;
  total: number | null;
};

type LocationRow = {
  user_id: string;
  country: string;
  city: string;
  sign_ins: number;
  requests: number;
  last_seen: string;
};

export type AdminPlace = { country: string; city: string; signIns: number; requests: number; lastSeen: string };

function toIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function adminOverview(db: Store, adminEmails: string[], now = Date.now()) {
  const today = dayKey(now);
  const since7 = dayKey(now - 6 * DAY_MS);
  const since30 = dayKey(now - (DAILY_SERIES_DAYS - 1) * DAY_MS);

  const rows = db
    .prepare(
      `SELECT u.id, u.email, u."createdAt" AS createdAt, b.blocked_at AS blockedAt,
              g.today, g.last7, g.last30, g.total
       FROM "user" u
       LEFT JOIN user_blocks b ON b.user_id = u.id
       LEFT JOIN (
         SELECT user_id,
                SUM(CASE WHEN day = ? THEN requests ELSE 0 END) AS today,
                SUM(CASE WHEN day >= ? THEN requests ELSE 0 END) AS last7,
                SUM(CASE WHEN day >= ? THEN requests ELSE 0 END) AS last30,
                SUM(requests) AS total
         FROM user_usage GROUP BY user_id
       ) g ON g.user_id = u.id
       ORDER BY u."createdAt" DESC`,
    )
    .all(today, since7, since30) as UserRow[];

  const locations = db
    .prepare(
      `SELECT user_id, country, city, sign_ins, requests, last_seen FROM user_locations
       ORDER BY requests + sign_ins DESC, last_seen DESC`,
    )
    .all() as LocationRow[];
  const placesByUser = new Map<string, AdminPlace[]>();
  const lastSeenByUser = new Map<string, string>();
  for (const row of locations) {
    const places = placesByUser.get(row.user_id) || [];
    places.push({
      country: row.country,
      city: row.city,
      signIns: Number(row.sign_ins),
      requests: Number(row.requests),
      lastSeen: row.last_seen,
    });
    placesByUser.set(row.user_id, places);
    const seen = lastSeenByUser.get(row.user_id);
    if (!seen || row.last_seen > seen) {
      lastSeenByUser.set(row.user_id, row.last_seen);
    }
  }

  const admins = new Set(adminEmails);
  const users = rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    createdAt: toIso(row.createdAt),
    lastSeen: lastSeenByUser.get(row.id) || null,
    blocked: Boolean(row.blockedAt),
    blockedAt: row.blockedAt,
    isAdmin: admins.has(String(row.email).toLowerCase()),
    requests: {
      today: Number(row.today || 0),
      last7: Number(row.last7 || 0),
      last30: Number(row.last30 || 0),
      total: Number(row.total || 0),
    },
    places: (placesByUser.get(row.id) || []).slice(0, LOCATIONS_PER_USER),
    placeCount: (placesByUser.get(row.id) || []).length,
  }));

  const dailyRows = db
    .prepare(
      `SELECT day, SUM(requests) AS requests, COUNT(DISTINCT user_id) AS users
       FROM user_usage WHERE day >= ? GROUP BY day`,
    )
    .all(since30) as Array<{ day: string; requests: number; users: number }>;
  const dailyByDay = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = [];
  for (let offset = DAILY_SERIES_DAYS - 1; offset >= 0; offset -= 1) {
    const day = dayKey(now - offset * DAY_MS);
    const row = dailyByDay.get(day);
    daily.push({ day, requests: Number(row?.requests || 0), users: Number(row?.users || 0) });
  }

  const countries = (
    db
      .prepare(
        `SELECT country, COUNT(DISTINCT user_id) AS users, SUM(requests) AS requests, SUM(sign_ins) AS signIns
         FROM user_locations GROUP BY country ORDER BY users DESC, requests DESC`,
      )
      .all() as Array<{ country: string; users: number; requests: number; signIns: number }>
  ).map((row) => ({
    country: row.country,
    users: Number(row.users),
    requests: Number(row.requests),
    signIns: Number(row.signIns),
  }));

  const cities = (
    db
      .prepare(
        `SELECT country, city, COUNT(DISTINCT user_id) AS users, SUM(requests) AS requests
         FROM user_locations WHERE city != '' GROUP BY country, city
         ORDER BY users DESC, requests DESC LIMIT ?`,
      )
      .all(TOP_CITIES) as Array<{ country: string; city: string; users: number; requests: number }>
  ).map((row) => ({ country: row.country, city: row.city, users: Number(row.users), requests: Number(row.requests) }));

  const anonymous = db
    .prepare(
      `SELECT COUNT(*) AS devices, COALESCE(SUM(count), 0) AS analyses
       FROM quota_counters WHERE kind = 'device' AND last_seen >= ?`,
    )
    .get(new Date(now - DAILY_SERIES_DAYS * DAY_MS).toISOString()) as { devices: number; analyses: number };

  return {
    generatedAt: new Date(now).toISOString(),
    today,
    stats: {
      users: users.length,
      blocked: users.filter((user) => user.blocked).length,
      activeToday: users.filter((user) => user.requests.today > 0).length,
      active30: users.filter((user) => user.requests.last30 > 0).length,
      requestsToday: users.reduce((sum, user) => sum + user.requests.today, 0),
      requests30: users.reduce((sum, user) => sum + user.requests.last30, 0),
      anonymousDevices30: Number(anonymous.devices),
      anonymousAnalyses30: Number(anonymous.analyses),
    },
    users,
    daily,
    countries,
    cities,
  };
}
