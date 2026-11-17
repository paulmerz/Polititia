import { existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { voteUrl, type Analytics } from "./analytics.ts";

// agenda.sqlite is written by build_agenda_db.py (schema: agenda_schema.sql)
// and published every day on the data release. Unlike analytics.sqlite, the
// server fetches it itself: the agenda changes daily, a redeploy would not.

export const AGENDA_REFRESH_MS = 3 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_DATABASE_BYTES = 512 * 1024 * 1024;
const DOSSIER_URL = "https://www.assemblee-nationale.fr/dyn/17/dossiers/";
// Public sittings of the Assembly: the dataset also announces the Senate's.
const ASSEMBLY_MEETING = "RUAN%";
const SHOWN_STATES = ["confirme", "eventuel"];
// Friendship and study groups and international assemblies are not committee
// work: a lunch with an ambassador is not on the order of business.
const NOT_COMMITTEE_WORK = ["GA", "GE", "GEVI", "API"];
const KEY_VOTES_SHOWN = 3;

type Theme = { id: string; label: string };

export type AgendaItem = {
  uid: string;
  state: string;
  type: string;
  subject: string;
  procedure: string;
  dossiers: string[];
};

export type AgendaSitting = { uid: string; startsAt: string; state: string; video: boolean; items: AgendaItem[] };

export type CommitteeMeeting = {
  uid: string;
  startsAt: string;
  organ: string;
  organName: string;
  topics: string[];
  video: boolean;
  openToPress: boolean;
};

export type AgendaDay = { date: string; sittings: AgendaSitting[]; committees: CommitteeMeeting[] };

export type KeyVote = { number: number; date: string; title: string; adopted: boolean; url: string };

// What Polititia already holds on a dossier, matched by its title (the one
// analytics.sqlite stores with each speech and vote).
export type DossierMemory = { speeches: number; sittings: number; lastDate: string; votes: number; keyVotes: KeyVote[] };

export type ThemeMemory = Theme & { speeches: number; keyVotes: number };

export type DossierCard = {
  uid: string;
  title: string;
  // The first agenda item about it: stands in when the dossier has no title.
  subject: string;
  kind: string;
  origin: string;
  procedure: string;
  depositedOn: string;
  committee: string;
  author: { name: string; group: string; coauthors: number } | null;
  themes: ThemeMemory[];
  firstDate: string;
  url: string;
  memory: DossierMemory | null;
};

export type AgendaView = {
  builtAt: string;
  today: string;
  lastConfirmedSitting: string;
  // First day of the analysed corpus, for "since July 2024"; '' without analytics.
  memorySince: string;
  days: AgendaDay[];
  dossiers: DossierCard[];
};

type MetaRow = { key: string; value: string };

export class Agenda {
  readonly db: DatabaseSync;
  readonly meta: { builtAt: string; lastConfirmedSitting: string };

  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true });
    const meta: Record<string, unknown> = {};
    for (const row of this.db.prepare("SELECT key, value FROM meta").all() as MetaRow[]) {
      try {
        meta[row.key] = JSON.parse(row.value);
      } catch {
        meta[row.key] = row.value;
      }
    }
    this.meta = {
      builtAt: String(meta.built_at || ""),
      lastConfirmedSitting: String(meta.last_confirmed_sitting || ""),
    };
  }

  close(): void {
    this.db.close();
  }
}

let shared: { path: string; mtimeMs: number; agenda: Agenda } | null = null;

export function openAgenda(path: string): Agenda | null {
  if (!existsSync(path)) {
    return null;
  }
  const mtimeMs = statSync(path).mtimeMs;
  if (shared && shared.path === path && shared.mtimeMs === mtimeMs) {
    return shared.agenda;
  }
  shared?.agenda.close();
  shared = null;
  try {
    shared = { path, mtimeMs, agenda: new Agenda(path) };
  } catch (error) {
    console.warn("Agenda database unreadable:", path, (error as Error).message);
    return null;
  }
  return shared.agenda;
}

function releaseAgenda(path: string): void {
  if (shared?.path === path) {
    shared.agenda.close();
    shared = null;
  }
}

// Refuses a file that is not an agenda database with at least one sitting.
export function validateAgendaFile(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'counts'").get() as { value: string } | undefined;
    const counts = row ? (JSON.parse(row.value) as Record<string, number>) : {};
    if (!counts.sittings) {
      throw new Error("no sittings in the agenda database");
    }
    db.prepare("SELECT COUNT(*) FROM dossiers").get();
  } finally {
    db.close();
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Downloads agenda.sqlite.gz to `dest`, replacing the current file only once
// the new one has been read back as an agenda database.
export async function downloadAgenda(url: string, dest: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length") || 0) > MAX_DOWNLOAD_BYTES) {
    throw new Error("agenda download too large");
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  if (compressed.length > MAX_DOWNLOAD_BYTES) {
    throw new Error("agenda download too large");
  }
  const tmp = `${dest}.download`;
  try {
    writeFileSync(tmp, gunzipSync(compressed, { maxOutputLength: MAX_DATABASE_BYTES }));
    validateAgendaFile(tmp);
    releaseAgenda(dest);
    renameSync(tmp, dest);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function startAgendaRefresh(config: { agendaUrl: string; agendaPath: string }): void {
  if (!config.agendaUrl) {
    return;
  }
  const refresh = async () => {
    try {
      await downloadAgenda(config.agendaUrl, config.agendaPath);
      console.log("Agenda refreshed from", config.agendaUrl);
    } catch (error) {
      console.warn("Agenda refresh failed, keeping the current file:", (error as Error).message);
    }
  };
  const fresh = existsSync(config.agendaPath) && Date.now() - statSync(config.agendaPath).mtimeMs < AGENDA_REFRESH_MS;
  if (!fresh) {
    void refresh();
  }
  setInterval(refresh, AGENDA_REFRESH_MS).unref();
}

// Today in Paris, where the sittings take place: "2026-11-17".
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseThemes(value: string): Theme[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id).map((item) => ({ id: String(item.id), label: String(item.label || item.id) })) : [];
  } catch {
    return [];
  }
}

type Memo = {
  byDossier: Map<string, { speeches: number; sittings: number; lastDate: string }>;
  votesByDossier: Map<string, Array<{ number: number; date: string; title: string; adopted: boolean; isKey: boolean }>>;
  themes: Map<string, { speeches: number; keyVotes: number }>;
};

// Computed once per analytics.sqlite (rebuilt weekly): a pass over the theme
// attributions and the votes.
const memos = new WeakMap<Analytics, Memo>();

function memoOf(analytics: Analytics): Memo {
  const cached = memos.get(analytics);
  if (cached) {
    return cached;
  }
  const memo: Memo = { byDossier: new Map(), votesByDossier: new Map(), themes: new Map() };
  const attributions = analytics.db
    .prepare(
      `SELECT ta.dossier_title AS title, COUNT(DISTINCT ta.sid) AS speeches,
              COUNT(DISTINCT s.session_uid) AS sittings, MAX(s.date) AS lastDate
         FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
        WHERE ta.dossier_title != '' GROUP BY ta.dossier_title`,
    )
    .all() as Array<{ title: string; speeches: number; sittings: number; lastDate: string }>;
  for (const row of attributions) {
    memo.byDossier.set(row.title, { speeches: row.speeches, sittings: row.sittings, lastDate: row.lastDate });
  }
  const votes = analytics.db
    .prepare(
      `SELECT number, date, title, adopted, is_key AS isKey, vote_type AS type, dossier_title AS dossier
         FROM votes WHERE dossier_title != '' ORDER BY date, number`,
    )
    .all() as Array<{ number: number; date: string; title: string; adopted: number; isKey: number; type: string; dossier: string }>;
  for (const vote of votes) {
    const list = memo.votesByDossier.get(vote.dossier) || [];
    // A motion de censure is about the Government, not the text.
    list.push({ number: vote.number, date: vote.date, title: vote.title, adopted: Boolean(vote.adopted), isKey: Boolean(vote.isKey) && vote.type !== "MOC" });
    memo.votesByDossier.set(vote.dossier, list);
  }
  for (const row of analytics.db
    .prepare("SELECT theme, COUNT(DISTINCT sid) AS speeches FROM theme_attributions GROUP BY theme")
    .all() as Array<{ theme: string; speeches: number }>) {
    memo.themes.set(row.theme, { speeches: row.speeches, keyVotes: 0 });
  }
  for (const row of analytics.db
    .prepare(
      `SELECT vt.theme AS theme, COUNT(*) AS keyVotes FROM vote_themes vt JOIN votes v ON v.vid = vt.vid
        WHERE v.is_key = 1 AND v.vote_type != 'MOC' GROUP BY vt.theme`,
    )
    .all() as Array<{ theme: string; keyVotes: number }>) {
    const entry = memo.themes.get(row.theme) || { speeches: 0, keyVotes: 0 };
    entry.keyVotes = row.keyVotes;
    memo.themes.set(row.theme, entry);
  }
  memos.set(analytics, memo);
  return memo;
}

function memoryOf(memo: Memo, title: string): DossierMemory {
  const speeches = memo.byDossier.get(title);
  const votes = memo.votesByDossier.get(title) || [];
  return {
    speeches: speeches?.speeches || 0,
    sittings: speeches?.sittings || 0,
    lastDate: speeches?.lastDate || "",
    votes: votes.length,
    keyVotes: votes
      .filter((vote) => vote.isKey)
      .slice(-KEY_VOTES_SHOWN)
      .map((vote) => ({ number: vote.number, date: vote.date, title: vote.title, adopted: vote.adopted, url: voteUrl(vote.number) })),
  };
}

type SittingRow = { uid: string; date: string; startsAt: string; state: string; video: number };
type ItemRow = { uid: string; state: string; type: string; subject: string; procedure: string };
type CommitteeRow = {
  uid: string;
  date: string;
  startsAt: string;
  organName: string;
  organShort: string;
  topics: string;
  video: number;
  openToPress: number;
};
type DossierRow = {
  uid: string;
  title: string;
  kind: string;
  origin: string;
  procedure: string;
  depositedOn: string;
  committee: string;
  authorName: string;
  authorGroup: string;
  coauthors: number;
  themes: string;
};

export function agendaView(
  agenda: Agenda,
  analytics: Analytics | null,
  today: string,
  options: { days?: number; committeeDays?: number } = {},
): AgendaView {
  const until = addDays(today, (options.days ?? 31) - 1);
  const committeesUntil = addDays(today, (options.committeeDays ?? 7) - 1);
  const states = SHOWN_STATES.map(() => "?").join(", ");
  const days = new Map<string, AgendaDay>();
  const dayOf = (date: string) => {
    let day = days.get(date);
    if (!day) {
      day = { date, sittings: [], committees: [] };
      days.set(date, day);
    }
    return day;
  };

  const sittings = agenda.db
    .prepare(
      `SELECT uid, date, starts_at AS startsAt, state, video FROM meetings
        WHERE kind = 'seance' AND uid LIKE ? AND state IN (${states}) AND date BETWEEN ? AND ?
        ORDER BY starts_at, uid`,
    )
    .all(ASSEMBLY_MEETING, ...SHOWN_STATES, today, until) as SittingRow[];
  const itemsOf = agenda.db.prepare(
    `SELECT uid, state, item_type AS type, subject, procedure FROM agenda_items
      WHERE meeting_uid = ? AND state IN (${states}) ORDER BY position`,
  );
  const dossiersOf = agenda.db.prepare("SELECT dossier_uid AS uid FROM agenda_item_dossiers WHERE item_uid = ? ORDER BY dossier_uid");
  const firstDates = new Map<string, string>();
  const firstSubjects = new Map<string, string>();
  for (const sitting of sittings) {
    const items = (itemsOf.all(sitting.uid, ...SHOWN_STATES) as ItemRow[]).map((item) => {
      const dossiers = (dossiersOf.all(item.uid) as Array<{ uid: string }>).map((row) => row.uid);
      for (const uid of dossiers) {
        if (!firstDates.has(uid)) {
          firstDates.set(uid, sitting.date);
          firstSubjects.set(uid, item.subject);
        }
      }
      return { ...item, dossiers };
    });
    dayOf(sitting.date).sittings.push({
      uid: sitting.uid,
      startsAt: sitting.startsAt,
      state: sitting.state,
      video: Boolean(sitting.video),
      items,
    });
  }

  const committees = agenda.db
    .prepare(
      `SELECT uid, date, starts_at AS startsAt, organ_name AS organName, organ_short AS organShort, topics,
              video, open_to_press AS openToPress
         FROM meetings
        WHERE kind = 'commission' AND uid LIKE ? AND state = 'confirme' AND date BETWEEN ? AND ?
          AND organ_type NOT IN (${NOT_COMMITTEE_WORK.map(() => "?").join(", ")})
        ORDER BY starts_at, uid`,
    )
    .all(ASSEMBLY_MEETING, today, committeesUntil, ...NOT_COMMITTEE_WORK) as CommitteeRow[];
  for (const meeting of committees) {
    dayOf(meeting.date).committees.push({
      uid: meeting.uid,
      startsAt: meeting.startsAt,
      organ: meeting.organShort || meeting.organName,
      organName: meeting.organName,
      topics: parseList(meeting.topics),
      video: Boolean(meeting.video),
      openToPress: Boolean(meeting.openToPress),
    });
  }

  const memo = analytics ? memoOf(analytics) : null;
  const dossierRow = agenda.db.prepare(
    `SELECT uid, title, kind, origin, procedure, deposited_on AS depositedOn, committee_name AS committee,
            author_name AS authorName, author_group AS authorGroup, coauthors, themes
       FROM dossiers WHERE uid = ?`,
  );
  const fallbackTitle = agenda.db.prepare(
    "SELECT dossier_title AS title FROM agenda_item_dossiers WHERE dossier_uid = ? AND dossier_title != '' LIMIT 1",
  );
  const dossiers: DossierCard[] = [...firstDates.entries()].map(([uid, firstDate]) => {
    const row = dossierRow.get(uid) as DossierRow | undefined;
    const title = row?.title || (fallbackTitle.get(uid) as { title: string } | undefined)?.title || "";
    return {
      uid,
      title,
      subject: firstSubjects.get(uid) || "",
      kind: row?.kind || "",
      origin: row?.origin || "",
      procedure: row?.procedure || "",
      depositedOn: row?.depositedOn || "",
      committee: row?.committee || "",
      author: row?.authorName ? { name: row.authorName, group: row.authorGroup, coauthors: row.coauthors } : null,
      themes: parseThemes(row?.themes || "[]").map((theme) => ({
        ...theme,
        speeches: memo?.themes.get(theme.id)?.speeches || 0,
        keyVotes: memo?.themes.get(theme.id)?.keyVotes || 0,
      })),
      firstDate,
      url: `${DOSSIER_URL}${encodeURIComponent(uid)}`,
      memory: memo && title ? memoryOf(memo, title) : null,
    };
  });

  return {
    builtAt: agenda.meta.builtAt,
    today,
    lastConfirmedSitting: agenda.meta.lastConfirmedSitting,
    memorySince: analytics?.meta.firstDate || "",
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    dossiers,
  };
}
