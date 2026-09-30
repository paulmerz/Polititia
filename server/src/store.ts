import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Store = DatabaseSync;

const RETURNS_ROWS = /^\s*(select|with|pragma|explain|values)\b/i;

function patchStatementColumns(db: DatabaseSync): void {
  const original = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const stmt = original(sql);
    if (typeof stmt.columns === "function") {
      return stmt;
    }
    const returnsRows = RETURNS_ROWS.test(sql) || /\breturning\b/i.test(sql);
    return Object.assign(stmt, {
      columns: () => (returnsRows ? [{ name: "_" }] : []),
    });
  }) as DatabaseSync["prepare"];
}

export function openStore(sqlitePath: string): Store {
  mkdirSync(path.dirname(sqlitePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(sqlitePath);
  patchStatementColumns(db);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_counters (
      kind TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      PRIMARY KEY (kind, key_hash)
    );
    CREATE TABLE IF NOT EXISTS auth_attempts (
      key_hash TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    );
  `);
  return db;
}
