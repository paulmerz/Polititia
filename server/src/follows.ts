import { timingSafeEqual } from "node:crypto";
import { hashIdentity } from "./quota.ts";
import type { Store } from "./store.ts";

// « Suivre mon député »: a signed-in visitor asks for an email when a deputy
// speaks or votes. `notified_through` is the last corpus day already covered,
// so the first alert only reports what happens after the follow.

export const MAX_FOLLOWS = 10;

export type Follow = { politicianId: string; createdAt: string; notifiedThrough: string };

export function listFollows(db: Store, userId: string): Follow[] {
  return (
    db
      .prepare(
        `SELECT politician_id AS politicianId, created_at AS createdAt, notified_through AS notifiedThrough
         FROM follows WHERE user_id = ? ORDER BY created_at, politician_id`,
      )
      .all(userId) as Follow[]
  ).map((row) => ({ ...row }));
}

export function addFollow(
  db: Store,
  userId: string,
  politicianId: string,
  since: string,
  now = new Date(),
): "added" | "exists" | "limit" {
  if (db.prepare("SELECT 1 FROM follows WHERE user_id = ? AND politician_id = ?").get(userId, politicianId)) {
    return "exists";
  }
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE user_id = ?").get(userId) as { n: number };
  if (n >= MAX_FOLLOWS) {
    return "limit";
  }
  db.prepare("INSERT INTO follows (user_id, politician_id, created_at, notified_through) VALUES (?, ?, ?, ?)").run(
    userId,
    politicianId,
    now.toISOString(),
    since,
  );
  return "added";
}

export function removeFollow(db: Store, userId: string, politicianId: string): boolean {
  return Number(db.prepare("DELETE FROM follows WHERE user_id = ? AND politician_id = ?").run(userId, politicianId).changes) > 0;
}

export function removeAllFollows(db: Store, userId: string): number {
  return Number(db.prepare("DELETE FROM follows WHERE user_id = ?").run(userId).changes);
}

export function markNotified(db: Store, userId: string, through: string): void {
  db.prepare("UPDATE follows SET notified_through = ? WHERE user_id = ? AND notified_through < ?").run(through, userId, through);
}

// The unsubscribe link works without signing in: it carries a MAC of the
// account id and of the deputy ("" for every alert of the account).
export function unsubscribeToken(secret: string, userId: string, politicianId = ""): string {
  return hashIdentity(secret, "unsubscribe", `${userId}\0${politicianId}`).slice(0, 32);
}

export function verifyUnsubscribe(secret: string, userId: string, politicianId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(secret, userId, politicianId));
  const given = Buffer.from(String(token || ""));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(baseURL: string, secret: string, userId: string, politicianId = ""): string {
  const params = new URLSearchParams({ u: userId });
  if (politicianId) {
    params.set("p", politicianId);
  }
  params.set("t", unsubscribeToken(secret, userId, politicianId));
  return `${baseURL}/desabonnement?${params}`;
}
