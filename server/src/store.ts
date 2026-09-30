import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Store = Database.Database;

const DAY_MS = 24 * 60 * 60 * 1000;
export const QUOTA_RETENTION_DAYS = 365;
export const SEEN_RETENTION_DAYS = 90;
export const ACCOUNT_RETENTION_DAYS = 3 * 365;

export function openStore(sqlitePath: string): Store {
  mkdirSync(path.dirname(sqlitePath), { recursive: true, mode: 0o700 });
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_counters (
      kind TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      PRIMARY KEY (kind, key_hash)
    );
    CREATE TABLE IF NOT EXISTS quota_seen (
      device_hash TEXT NOT NULL,
      key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (device_hash, key)
    );
    CREATE TABLE IF NOT EXISTS auth_attempts (
      key_hash TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_sends (
      key_hash TEXT PRIMARY KEY,
      last_sent INTEGER NOT NULL
    );
  `);
  return db;
}

// Retention promised on the /conditions page.
export function purgeStale(db: Store, now = Date.now()): void {
  const quotaCutoff = new Date(now - QUOTA_RETENTION_DAYS * DAY_MS).toISOString();
  const seenCutoff = new Date(now - SEEN_RETENTION_DAYS * DAY_MS).toISOString();
  const nowSeconds = Math.floor(now / 1000);
  db.prepare("DELETE FROM quota_counters WHERE last_seen < ?").run(quotaCutoff);
  db.prepare("DELETE FROM quota_seen WHERE created_at < ?").run(seenCutoff);
  db.prepare("DELETE FROM auth_attempts WHERE window_start < ?").run(nowSeconds - 24 * 60 * 60);
  db.prepare("DELETE FROM email_sends WHERE last_sent < ?").run(nowSeconds - 24 * 60 * 60);
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  if (tables.has("verification")) {
    // Pending magic links hold the address until it is verified.
    db.prepare(`DELETE FROM verification WHERE "expiresAt" < ?`).run(new Date(now).toISOString());
  }
  if (tables.has("user") && tables.has("session")) {
    const accountCutoff = new Date(now - ACCOUNT_RETENTION_DAYS * DAY_MS).toISOString();
    db.prepare(
      `DELETE FROM "user" WHERE "updatedAt" < ?
       AND id NOT IN (SELECT "userId" FROM "session" WHERE "updatedAt" >= ?)`,
    ).run(accountCutoff, accountCutoff);
  }
}
