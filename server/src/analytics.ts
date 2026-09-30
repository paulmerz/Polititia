import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { dirichletLogOdds, MIN_COUNT, type LogOddsRow } from "./lexical.ts";

// Everything a visitor can filter by period is computed here from the monthly
// aggregates of analytics.sqlite (see build_analytics_db.py).

const NGRAM_SIZES = [1, 2, 3, 4] as const;
const TOP_PHRASES = 25;
const EXCERPT_LIMIT = 6;
const REPORT_URL = "https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/";
const VOTE_URL = "https://www.assemblee-nationale.fr/dyn/17/scrutins/";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/;
// Groups that are not parliamentary groups: government members and people
// heard in the chamber without a deputy mandate.
const NON_DEPUTY_PARTIES = new Set(["GOUV", "UNLABELED"]);
const CACHE_LIMIT = 400;

export type ThemeCatalogEntry = { id: string; label: string; type: string; parent: string | null; committee: string };

export type AnalyticsMeta = {
  firstDate: string;
  lastDate: string;
  months: string[];
  sessions: Array<{ id: string; label: string; from: string; to: string }>;
  alpha0: number;
  corpusTotals: Record<string, number>;
  builtOn: string;
  themes: ThemeCatalogEntry[];
};

export type Period = { from: string; to: string; firstDay: string; lastDay: string; isAll: boolean };

export class PeriodError extends Error {}

type PhraseRow = { ngram: string; count: number; ratio?: number; z?: number };
type PhrasesBySize = Record<string, PhraseRow[]>;

type VoteRow = {
  vid: number;
  number: number;
  date: string;
  title: string;
  adopted: number;
  vote_type: string;
  is_key: number;
  dossier_title: string;
  group_majority: string;
  group_counts: string;
};

type GroupCounts = { pour: number; contre: number; abstention: number; members?: number };

function reportUrl(sessionUid: string): string {
  return sessionUid ? `${REPORT_URL}${encodeURIComponent(sessionUid)}` : "";
}

function voteUrl(number: number): string {
  return `${VOTE_URL}${number}`;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stanceLevel(favorable: number, unfavorable: number, mixed: number): string {
  const total = favorable + unfavorable + mixed;
  if (!total) {
    return "non-exprime";
  }
  if (favorable === total) {
    return "favorable";
  }
  if (unfavorable === total) {
    return "defavorable";
  }
  if (favorable * 3 >= total * 2) {
    return "plutot-favorable";
  }
  if (unfavorable * 3 >= total * 2) {
    return "plutot-defavorable";
  }
  return "partage";
}

export class Analytics {
  readonly db: Database.Database;
  readonly meta: AnalyticsMeta;
  readonly themeIds: Map<string, ThemeCatalogEntry>;
  private cache = new Map<string, unknown>();
  private voteGroups = new Map<number, { majority: Record<string, string>; counts: Record<string, GroupCounts> }>();

  constructor(readonly path: string) {
    this.db = new Database(path, { readonly: true, fileMustExist: true });
    this.db.pragma("query_only = ON");
    const rows = this.db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>;
    const meta = Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value, null)])) as Partial<AnalyticsMeta>;
    this.meta = {
      firstDate: meta.firstDate || "",
      lastDate: meta.lastDate || "",
      months: meta.months || [],
      sessions: meta.sessions || [],
      alpha0: Number(meta.alpha0 || 1000),
      corpusTotals: meta.corpusTotals || {},
      builtOn: meta.builtOn || "",
      themes: meta.themes || [],
    };
    this.themeIds = new Map(this.meta.themes.map((theme) => [theme.id, theme]));
  }

  close(): void {
    this.db.close();
  }

  // -- periods ------------------------------------------------------------

  period(from?: string | null, to?: string | null): Period {
    const first = this.meta.firstDate.slice(0, 7);
    const last = this.meta.lastDate.slice(0, 7);
    const start = from || first;
    const end = to || last;
    if (!MONTH_RE.test(start) || !MONTH_RE.test(end)) {
      throw new PeriodError("invalid_period");
    }
    if (start > end) {
      throw new PeriodError("invalid_period");
    }
    const clampedStart = start < first ? first : start;
    const clampedEnd = end > last ? last : end;
    if (clampedStart > clampedEnd) {
      throw new PeriodError("empty_period");
    }
    return {
      from: clampedStart,
      to: clampedEnd,
      firstDay: `${clampedStart}-01`,
      lastDay: `${clampedEnd}-31`,
      isAll: clampedStart === first && clampedEnd === last,
    };
  }

  private cached<T>(key: string, compute: () => T): T {
    if (this.cache.has(key)) {
      const value = this.cache.get(key) as T;
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    const value = compute();
    this.cache.set(key, value);
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    return value;
  }

  isValidId(id: string): boolean {
    return ID_RE.test(id);
  }

  private themeFilter(themeId: string): string[] {
    const theme = this.themeIds.get(themeId);
    if (!theme) {
      return [];
    }
    return [theme.id];
  }

  // -- phrases ------------------------------------------------------------

  private priorFor(n: number) {
    const total = Number(this.meta.corpusTotals[String(n)] || 0) || 1;
    return (corpusCount: number) => corpusCount / total;
  }

  private globalTotal(n: number, period: Period): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(total), 0) AS total FROM global_totals WHERE n = ? AND month BETWEEN ? AND ?")
      .get(n, period.from, period.to) as { total: number };
    return Number(row.total || 0);
  }

  private commonGlobal(n: number, period: Period): PhraseRow[] {
    if (period.isAll) {
      return (
        this.db
          .prepare("SELECT text AS ngram, total AS count FROM ngrams WHERE n = ? ORDER BY total DESC LIMIT ?")
          .all(n, TOP_PHRASES) as PhraseRow[]
      ).map((row) => ({ ngram: row.ngram, count: Number(row.count) }));
    }
    return (
      this.db
        .prepare(
          `SELECT ng.text AS ngram, SUM(g.count) AS count
           FROM ngrams ng JOIN global_ngram_month g ON g.gid = ng.gid
           WHERE ng.n = ? AND g.month BETWEEN ? AND ?
           GROUP BY ng.gid ORDER BY count DESC LIMIT ?`,
        )
        .all(n, period.from, period.to, TOP_PHRASES) as PhraseRow[]
    ).map((row) => ({ ngram: row.ngram, count: Number(row.count) }));
  }

  // Common and distinctive phrases for one politician (`pid`) or one group.
  private phrases(kind: "person" | "party", key: number | string, period: Period) {
    const table = kind === "person" ? "person_ngram_month" : "party_ngram_month";
    const totals = kind === "person" ? "person_totals" : "party_totals";
    const column = kind === "person" ? "pid" : "party";
    const common: PhrasesBySize = {};
    const distinctive: PhrasesBySize = {};
    for (const n of NGRAM_SIZES) {
      const targetTotal = Number(
        (
          this.db
            .prepare(`SELECT COALESCE(SUM(total), 0) AS total FROM ${totals} WHERE ${column} = ? AND n = ? AND month BETWEEN ? AND ?`)
            .get(key, n, period.from, period.to) as { total: number }
        ).total || 0,
      );
      const everyoneColumn = period.isAll
        ? "ng.total"
        : "(SELECT SUM(g.count) FROM global_ngram_month g WHERE g.gid = t.gid AND g.month BETWEEN @from AND @to)";
      const rows = this.db
        .prepare(
          `WITH t AS (
             SELECT gid, SUM(count) AS c FROM ${table}
             WHERE ${column} = @key AND n = @n AND month BETWEEN @from AND @to
             GROUP BY gid HAVING c >= @minCount
           )
           SELECT ng.text AS ngram, t.c AS count, ng.total AS corpus, ${everyoneColumn} AS everyone
           FROM t JOIN ngrams ng ON ng.gid = t.gid`,
        )
        .all({ key, n, from: period.from, to: period.to, minCount: MIN_COUNT }) as Array<{
        ngram: string;
        count: number;
        corpus: number;
        everyone: number;
      }>;
      rows.sort((a, b) => b.count - a.count || (a.ngram < b.ngram ? -1 : 1));
      common[String(n)] = rows.slice(0, TOP_PHRASES).map((row) => ({ ngram: row.ngram, count: Number(row.count) }));

      const prior = this.priorFor(n);
      const target = new Map<string, number>();
      const everyone = new Map<string, number>();
      const priors = new Map<string, number>();
      for (const row of rows) {
        target.set(row.ngram, Number(row.count));
        everyone.set(row.ngram, Number(row.everyone || row.count));
        priors.set(row.ngram, prior(Number(row.corpus)));
      }
      const scored: LogOddsRow[] = dirichletLogOdds(target, targetTotal, everyone, this.globalTotal(n, period), priors, {
        alpha0: this.meta.alpha0,
      });
      distinctive[String(n)] = scored.slice(0, TOP_PHRASES).map((row) => ({
        ngram: row.ngram,
        count: row.count,
        ratio: Number(row.ratio.toFixed(3)),
        z: Number(row.z.toFixed(3)),
      }));
    }
    return { common, distinctive };
  }

  // -- shared pieces --------------------------------------------------------

  private activityByPolitician(period: Period): Map<number, { speeches: number; words: number }> {
    return this.cached(`activity:${period.from}:${period.to}`, () => {
      const rows = this.db
        .prepare(
          `SELECT pid, COUNT(*) AS speeches, SUM(words) AS words
           FROM speeches WHERE date BETWEEN ? AND ? GROUP BY pid`,
        )
        .all(period.firstDay, period.lastDay) as Array<{ pid: number; speeches: number; words: number }>;
      return new Map(rows.map((row) => [row.pid, { speeches: Number(row.speeches), words: Number(row.words || 0) }]));
    });
  }

  private deputyPids(): Map<number, { id: string; party: string }> {
    return this.cached("deputies", () => {
      const rows = this.db.prepare("SELECT pid, id, party FROM politicians").all() as Array<{
        pid: number;
        id: string;
        party: string;
      }>;
      return new Map(rows.map((row) => [row.pid, { id: row.id, party: row.party }]));
    });
  }

  private excerpts(where: string, params: unknown[], themeIds: string[], limit = EXCERPT_LIMIT, diverseParties = false) {
    const themeClause = themeIds.length
      ? `AND (ta.theme IN (${themeIds.map(() => "?").join(",")}) OR ta.domain IN (${themeIds.map(() => "?").join(",")}))`
      : "";
    const rows = this.db
      .prepare(
        `SELECT s.speech_id AS speechId, s.date, s.session_uid AS sessionUid, s.debate_title AS debate,
                s.party, p.id AS politicianId, p.name AS speaker, ta.theme, ta.excerpt, ta.method,
                ta.dossier_title AS dossier
         FROM theme_attributions ta
         JOIN speeches s ON s.sid = ta.sid
         JOIN politicians p ON p.pid = s.pid
         WHERE ${where} AND ta.method != 'domain' AND length(ta.excerpt) >= 80 ${themeClause}
         ORDER BY (ta.method = 'debate') DESC, s.date DESC
         LIMIT 400`,
      )
      .all(...params, ...themeIds, ...themeIds) as Array<Record<string, string>>;
    const seen = new Set<string>();
    const parties = new Set<string>();
    const picked: Array<Record<string, string>> = [];
    // First one excerpt per group, then fill with the next best ones.
    for (const pass of diverseParties ? ["diverse", "fill"] : ["fill"]) {
      for (const row of rows) {
        if (picked.length >= limit) {
          break;
        }
        if (seen.has(row.speechId) || (pass === "diverse" && parties.has(row.party))) {
          continue;
        }
        seen.add(row.speechId);
        parties.add(row.party);
        picked.push(row);
      }
    }
    picked.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return picked.map((row) => ({
      politicianId: row.politicianId,
      speaker: row.speaker,
      party: row.party,
      date: row.date,
      debate: row.debate || row.dossier,
      theme: row.theme,
      method: row.method,
      snippet: row.excerpt,
      url: reportUrl(row.sessionUid),
    }));
  }

  private voteSummary(vote: VoteRow) {
    const { majority, counts } = this.groupsOf(vote);
    const groups: Record<string, string> = {};
    for (const party of Object.keys(majority)) {
      groups[party] = this.groupPosition(vote, party);
    }
    return {
      number: vote.number,
      date: vote.date,
      title: vote.title,
      adopted: Boolean(vote.adopted),
      type: vote.vote_type,
      isKey: Boolean(vote.is_key),
      dossier: vote.dossier_title,
      total: counts._total || null,
      groups,
      url: voteUrl(vote.number),
    };
  }

  private themeVoteIds(themeId: string): Set<number> {
    return this.cached(`vote-themes:${themeId}`, () => {
      const rows = this.db.prepare("SELECT vid FROM vote_themes WHERE theme = ?").all(themeId) as Array<{ vid: number }>;
      return new Set(rows.map((row) => row.vid));
    });
  }

  private stancesFor(where: string, params: unknown[]) {
    const rows = this.db
      .prepare(
        `SELECT st.theme, st.stance, st.confidence, st.method, st.quote, s.date, s.debate_title AS debate,
                s.session_uid AS sessionUid, s.party, p.id AS politicianId, p.name AS speaker
         FROM stances st JOIN speeches s ON s.sid = st.sid JOIN politicians p ON p.pid = s.pid
         WHERE ${where}
         ORDER BY s.date DESC`,
      )
      .all(...params) as Array<Record<string, string | number>>;
    return rows;
  }

  private aggregateStances(rows: Array<Record<string, string | number>>, key: (row: Record<string, string | number>) => string) {
    const groups = new Map<string, Array<Record<string, string | number>>>();
    for (const row of rows) {
      const k = key(row);
      if (!groups.has(k)) {
        groups.set(k, []);
      }
      groups.get(k)?.push(row);
    }
    return [...groups.entries()].map(([k, items]) => {
      const favorable = items.filter((item) => item.stance === "favorable").length;
      const unfavorable = items.filter((item) => item.stance === "defavorable").length;
      const mixed = items.length - favorable - unfavorable;
      return {
        key: k,
        level: stanceLevel(favorable, unfavorable, mixed),
        favorable,
        unfavorable,
        mixed,
        quotes: items.slice(0, 3).map((item) => ({
          stance: item.stance,
          quote: item.quote,
          date: item.date,
          debate: item.debate,
          speaker: item.speaker,
          politicianId: item.politicianId,
          party: item.party,
          method: item.method,
          url: reportUrl(String(item.sessionUid)),
        })),
      };
    });
  }

  private allVotes(): Map<number, VoteRow> {
    return this.cached("votes", () => {
      const rows = this.db.prepare("SELECT * FROM votes").all() as VoteRow[];
      return new Map(rows.map((row) => [row.vid, row]));
    });
  }

  private groupsOf(vote: VoteRow) {
    let groups = this.voteGroups.get(vote.vid);
    if (!groups) {
      groups = {
        majority: parseJson<Record<string, string>>(vote.group_majority, {}),
        counts: parseJson<Record<string, GroupCounts>>(vote.group_counts, {}),
      };
      this.voteGroups.set(vote.vid, groups);
    }
    return groups;
  }

  // Computed from the group's tally, never from "positionMajoritaire" (see
  // reference_data.majority_position). A motion of censure only records the
  // deputies who vote for it: a group supports it when most members signed.
  private groupPosition(vote: VoteRow, party: string): string {
    const { majority, counts } = this.groupsOf(vote);
    const group = counts[party];
    if (!group) {
      return majority[party] || "";
    }
    if (vote.vote_type === "MOC") {
      return group.members ? (group.pour * 2 > group.members ? "pour" : "contre") : "";
    }
    const ranked = (["pour", "contre", "abstention"] as const)
      .map((key) => [Number(group[key] || 0), key] as const)
      .sort((a, b) => b[0] - a[0]);
    if (ranked[0][0] === 0 || ranked[0][0] === ranked[1][0]) {
      return "";
    }
    return ranked[0][1];
  }

  // -- views ----------------------------------------------------------------

  politician(id: string, period: Period, themeId = "") {
    if (!this.isValidId(id)) {
      return null;
    }
    const themeIds = themeId ? this.themeFilter(themeId) : [];
    return this.cached(`politician:${id}:${period.from}:${period.to}:${themeIds.join(",")}`, () => {
      const person = this.db.prepare("SELECT pid, id, name, party, acteur_id FROM politicians WHERE id = ?").get(id) as
        | { pid: number; id: string; name: string; party: string; acteur_id: string }
        | undefined;
      if (!person) {
        return null;
      }
      const range = [person.pid, period.firstDay, period.lastDay];
      const activity = this.db
        .prepare(
          `SELECT COUNT(*) AS speeches, COALESCE(SUM(words), 0) AS words, COUNT(DISTINCT session_uid) AS sittings,
                  MIN(date) AS firstDate, MAX(date) AS lastDate
           FROM speeches WHERE pid = ? AND date BETWEEN ? AND ?`,
        )
        .get(...range) as { speeches: number; words: number; sittings: number; firstDate: string | null; lastDate: string | null };
      const roles = this.db
        .prepare("SELECT party, COUNT(*) AS speeches FROM speeches WHERE pid = ? AND date BETWEEN ? AND ? GROUP BY party ORDER BY speeches DESC")
        .all(...range) as Array<{ party: string; speeches: number }>;

      const everyone = this.activityByPolitician(period);
      const deputies = this.deputyPids();
      let deputyCount = 0;
      let quieter = 0;
      for (const [pid, info] of deputies) {
        if (NON_DEPUTY_PARTIES.has(info.party)) {
          continue;
        }
        deputyCount += 1;
        if ((everyone.get(pid)?.speeches || 0) < activity.speeches) {
          quieter += 1;
        }
      }

      const themes = (
        this.db
          .prepare(
            `SELECT ta.theme AS id, COUNT(*) AS speechCount
             FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
             WHERE s.pid = ? AND s.date BETWEEN ? AND ?
             GROUP BY ta.theme ORDER BY speechCount DESC, ta.theme`,
          )
          .all(...range) as Array<{ id: string; speechCount: number }>
      ).map((row) => ({
        id: row.id,
        speechCount: Number(row.speechCount),
        share: activity.speeches ? Number(row.speechCount) / activity.speeches : 0,
      }));

      const words = activity.speeches ? this.phrases("person", person.pid, period) : { common: {}, distinctive: {} };

      return {
        id: person.id,
        name: person.name,
        party: person.party,
        acteurId: person.acteur_id,
        period: { from: period.from, to: period.to },
        theme: themeIds[0] || null,
        activity: {
          speeches: Number(activity.speeches),
          words: Number(activity.words),
          sittings: Number(activity.sittings),
          firstDate: activity.firstDate,
          lastDate: activity.lastDate,
          moreActiveThan: deputyCount && !NON_DEPUTY_PARTIES.has(person.party) ? quieter / deputyCount : null,
        },
        roles,
        themes,
        words,
        excerpts: this.excerpts("s.pid = ? AND s.date BETWEEN ? AND ?", range, themeIds),
        votes: this.politicianVotes(person.pid, period, themeIds[0] || ""),
        stances: this.aggregateStances(
          this.stancesFor(
            `s.pid = ? AND s.date BETWEEN ? AND ?${themeIds.length ? " AND st.theme = ?" : ""}`,
            themeIds.length ? [...range, themeIds[0]] : range,
          ),
          (row) => String(row.theme),
        ).map(({ key, ...rest }) => ({ theme: key, ...rest })),
      };
    });
  }

  private politicianVotes(pid: number, period: Period, themeId: string) {
    const positioned = this.db
      .prepare(
        `SELECT v.*, vp.position, vp.party AS voteParty
         FROM vote_positions vp JOIN votes v ON v.vid = vp.vid
         WHERE vp.pid = ? AND v.date BETWEEN ? AND ?
         ORDER BY v.date DESC, v.number DESC`,
      )
      .all(pid, period.firstDay, period.lastDay) as Array<VoteRow & { position: string; voteParty: string }>;
    if (!positioned.length) {
      return { cast: 0, withGroup: 0, comparable: 0, list: [], deviations: [], absentKey: 0, themeVotes: 0 };
    }
    const themeVids = themeId ? this.themeVoteIds(themeId) : null;
    let comparable = 0;
    let withGroup = 0;
    const entries = positioned.map((vote) => {
      const group = this.groupPosition(vote, vote.voteParty);
      const counted = vote.vote_type !== "MOC" && ["pour", "contre", "abstention"].includes(vote.position) && ["pour", "contre", "abstention"].includes(group);
      if (counted) {
        comparable += 1;
        if (group === vote.position) {
          withGroup += 1;
        }
      }
      return {
        ...this.voteSummary(vote),
        position: vote.position,
        party: vote.voteParty,
        groupPosition: group,
        deviates: counted && group !== vote.position,
        vid: vote.vid,
      };
    });
    const onTheme = themeVids ? entries.filter((entry) => themeVids.has(entry.vid)) : entries;
    const keyVotes = onTheme.filter((entry) => entry.isKey);
    const list = (themeVids ? [...keyVotes, ...onTheme.filter((entry) => !entry.isKey)] : keyVotes).slice(0, 15);

    // Key votes they missed while holding a seat (between their first and last
    // recorded vote in the period); ministers are not deputies and are skipped.
    // Not signing a censure motion is a position, not an absence.
    const first = positioned[positioned.length - 1].date;
    const last = positioned[0].date;
    const cast = new Set(positioned.map((vote) => vote.vid));
    const missed = (
      this.db
        .prepare("SELECT * FROM votes WHERE is_key = 1 AND vote_type != 'MOC' AND date BETWEEN ? AND ? ORDER BY date DESC")
        .all(first, last) as VoteRow[]
    ).filter((vote) => !cast.has(vote.vid) && (!themeVids || themeVids.has(vote.vid)));

    const strip = ({ vid: _vid, ...rest }: (typeof entries)[number]) => rest;
    return {
      cast: positioned.length,
      comparable,
      withGroup,
      themeVotes: themeVids ? onTheme.length : null,
      list: list.map(strip),
      deviations: onTheme.filter((entry) => entry.deviates).slice(0, 5).map(strip),
      absentKey: missed.length,
      missed: missed.slice(0, 5).map((vote) => ({ ...this.voteSummary(vote), position: "absent" })),
    };
  }

  party(partyId: string, period: Period) {
    if (!this.isValidId(partyId)) {
      return null;
    }
    return this.cached(`party:${partyId}:${period.from}:${period.to}`, () => {
      const stats = this.db
        .prepare(
          `SELECT COUNT(*) AS speeches, COALESCE(SUM(words), 0) AS words, COUNT(DISTINCT pid) AS speakers
           FROM speeches WHERE party = ? AND date BETWEEN ? AND ?`,
        )
        .get(partyId, period.firstDay, period.lastDay) as { speeches: number; words: number; speakers: number };
      const members = (this.db.prepare("SELECT COUNT(*) AS n FROM politicians WHERE party = ?").get(partyId) as { n: number }).n;
      if (!stats.speeches && !members) {
        return null;
      }
      const themes = (
        this.db
          .prepare(
            `SELECT ta.theme AS id, COUNT(*) AS speechCount
             FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
             WHERE s.party = ? AND s.date BETWEEN ? AND ?
             GROUP BY ta.theme ORDER BY speechCount DESC`,
          )
          .all(partyId, period.firstDay, period.lastDay) as Array<{ id: string; speechCount: number }>
      ).map((row) => ({
        id: row.id,
        speechCount: Number(row.speechCount),
        share: stats.speeches ? Number(row.speechCount) / stats.speeches : 0,
      }));
      const speakers = this.db
        .prepare(
          `SELECT p.id, p.name, COUNT(*) AS speeches, COALESCE(SUM(s.words), 0) AS words
           FROM speeches s JOIN politicians p ON p.pid = s.pid
           WHERE s.party = ? AND s.date BETWEEN ? AND ?
           GROUP BY s.pid ORDER BY speeches DESC LIMIT 10`,
        )
        .all(partyId, period.firstDay, period.lastDay);

      const positions = this.db
        .prepare(
          `SELECT vp.vid, vp.position, COUNT(*) AS n FROM vote_positions vp JOIN votes v ON v.vid = vp.vid
           WHERE vp.party = ? AND v.date BETWEEN ? AND ? AND v.vote_type != 'MOC'
           GROUP BY vp.vid, vp.position`,
        )
        .all(partyId, period.firstDay, period.lastDay) as Array<{ vid: number; position: string; n: number }>;
      const votesById = this.allVotes();
      let comparable = 0;
      let withGroup = 0;
      for (const row of positions) {
        const vote = votesById.get(row.vid);
        const group = vote ? this.groupPosition(vote, partyId) : "";
        if (["pour", "contre", "abstention"].includes(group) && ["pour", "contre", "abstention"].includes(row.position)) {
          comparable += Number(row.n);
          if (group === row.position) {
            withGroup += Number(row.n);
          }
        }
      }
      const keyVotes = (
        this.db
          .prepare("SELECT * FROM votes WHERE is_key = 1 AND date BETWEEN ? AND ? ORDER BY date DESC, number DESC LIMIT 15")
          .all(period.firstDay, period.lastDay) as VoteRow[]
      ).map((vote) => ({ ...this.voteSummary(vote), groupPosition: this.groupPosition(vote, partyId) }));

      return {
        id: partyId,
        period: { from: period.from, to: period.to },
        stats: { speeches: Number(stats.speeches), words: Number(stats.words), speakers: Number(stats.speakers), members },
        cohesion: comparable ? { comparable, withGroup, share: withGroup / comparable } : null,
        themes,
        speakers,
        words: stats.speeches ? this.phrases("party", partyId, period) : { common: {}, distinctive: {} },
        keyVotes,
        stances: this.aggregateStances(this.stancesFor("s.party = ? AND s.date BETWEEN ? AND ?", [partyId, period.firstDay, period.lastDay]), (row) =>
          String(row.theme),
        ).map(({ key, ...rest }) => ({ theme: key, ...rest })),
      };
    });
  }

  theme(themeId: string, period: Period) {
    const theme = this.themeIds.get(themeId);
    if (!theme) {
      return null;
    }
    return this.cached(`theme:${themeId}:${period.from}:${period.to}`, () => {
      const range = [themeId, period.firstDay, period.lastDay];
      const perPolitician = this.db
        .prepare(
          `SELECT s.pid, COUNT(*) AS speechCount, MIN(s.date) AS firstDate
           FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
           WHERE ta.theme = ? AND s.date BETWEEN ? AND ?
           GROUP BY s.pid`,
        )
        .all(...range) as Array<{ pid: number; speechCount: number; firstDate: string }>;
      const perParty = this.db
        .prepare(
          `SELECT s.party, COUNT(*) AS speechCount, MIN(s.date) AS firstDate
           FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
           WHERE ta.theme = ? AND s.date BETWEEN ? AND ?
           GROUP BY s.party`,
        )
        .all(...range) as Array<{ party: string; speechCount: number; firstDate: string }>;
      const partyTotals = new Map(
        (
          this.db
            .prepare("SELECT party, COUNT(*) AS speeches FROM speeches WHERE date BETWEEN ? AND ? GROUP BY party")
            .all(period.firstDay, period.lastDay) as Array<{ party: string; speeches: number }>
        ).map((row) => [row.party, Number(row.speeches)]),
      );
      const allSpeeches = [...partyTotals.values()].reduce((sum, value) => sum + value, 0);
      const themeSpeeches = perParty.reduce((sum, row) => sum + Number(row.speechCount), 0);
      const overallShare = allSpeeches ? themeSpeeches / allSpeeches : 0;
      const ownership = perParty
        .map((row) => {
          const total = partyTotals.get(row.party) || 0;
          const share = total ? Number(row.speechCount) / total : 0;
          return {
            party: row.party,
            speechCount: Number(row.speechCount),
            share,
            lift: overallShare ? share / overallShare : 0,
            firstDate: row.firstDate,
          };
        })
        .sort((a, b) => b.lift - a.lift);

      const activity = this.activityByPolitician(period);
      const deputies = this.deputyPids();
      const politicianScores: Record<string, { speechCount: number; share: number; firstDate: string }> = {};
      for (const row of perPolitician) {
        const info = deputies.get(row.pid);
        if (!info) {
          continue;
        }
        const total = activity.get(row.pid)?.speeches || 0;
        politicianScores[info.id] = {
          speechCount: Number(row.speechCount),
          share: total ? Number(row.speechCount) / total : 0,
          firstDate: row.firstDate,
        };
      }
      const speakers = this.db
        .prepare(
          `SELECT p.id, p.name, s.party, COUNT(*) AS speechCount
           FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid JOIN politicians p ON p.pid = s.pid
           WHERE ta.theme = ? AND s.date BETWEEN ? AND ?
           GROUP BY s.pid ORDER BY speechCount DESC LIMIT 10`,
        )
        .all(...range);

      const monthly = this.db
        .prepare(
          `SELECT s.month, s.party, COUNT(*) AS speechCount
           FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
           WHERE ta.theme = ? AND s.date BETWEEN ? AND ?
           GROUP BY s.month, s.party`,
        )
        .all(...range) as Array<{ month: string; party: string; speechCount: number }>;
      const monthTotals = this.db
        .prepare("SELECT month, party, COUNT(*) AS speeches FROM speeches WHERE date BETWEEN ? AND ? GROUP BY month, party")
        .all(period.firstDay, period.lastDay) as Array<{ month: string; party: string; speeches: number }>;
      const totalsByKey = new Map(monthTotals.map((row) => [`${row.month}|${row.party}`, Number(row.speeches)]));
      const series: Record<string, Array<{ month: string; speechCount: number; share: number }>> = {};
      for (const row of monthly) {
        const total = totalsByKey.get(`${row.month}|${row.party}`) || 0;
        (series[row.party] ||= []).push({
          month: row.month,
          speechCount: Number(row.speechCount),
          share: total ? Number(row.speechCount) / total : 0,
        });
      }
      const months = this.meta.months.filter((month) => month >= period.from && month <= period.to);

      const themeVids = this.themeVoteIds(themeId);
      const periodVotes = (
        this.db.prepare("SELECT * FROM votes WHERE date BETWEEN ? AND ? ORDER BY date DESC, number DESC").all(period.firstDay, period.lastDay) as VoteRow[]
      ).filter((vote) => themeVids.has(vote.vid));
      const keyVotes = periodVotes.filter((vote) => vote.is_key).slice(0, 12).map((vote) => this.voteSummary(vote));

      const debates = this.db
        .prepare(
          `SELECT COUNT(DISTINCT s.debate_title) AS n FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
           WHERE ta.theme = ? AND s.date BETWEEN ? AND ? AND ta.method = 'debate'`,
        )
        .get(...range) as { n: number };

      return {
        id: theme.id,
        label: theme.label,
        type: theme.type,
        parent: theme.parent,
        committee: theme.committee,
        period: { from: period.from, to: period.to },
        stats: {
          speeches: themeSpeeches,
          politicians: Object.keys(politicianScores).length,
          debates: Number(debates.n || 0),
          shareOfAll: overallShare,
          votes: periodVotes.length,
          firstDate: perParty.reduce((min, row) => (!min || row.firstDate < min ? row.firstDate : min), ""),
        },
        ownership,
        politicianScores,
        speakers,
        months,
        series,
        keyVotes,
        excerpts: this.excerpts("s.date BETWEEN ? AND ?", [period.firstDay, period.lastDay], [themeId], EXCERPT_LIMIT, true),
        stances: this.aggregateStances(this.stancesFor("st.theme = ? AND s.date BETWEEN ? AND ?", range), (row) => String(row.party)).map(
          ({ key, ...rest }) => ({ party: key, ...rest }),
        ),
      };
    });
  }

  assembly(period: Period) {
    return this.cached(`assembly:${period.from}:${period.to}`, () => {
      const activity = this.activityByPolitician(period);
      const deputies = this.deputyPids();
      const chamber: Record<string, [number, number]> = {};
      for (const [pid, info] of deputies) {
        const row = activity.get(pid);
        chamber[info.id] = [row?.speeches || 0, row?.words || 0];
      }
      const parties = (
        this.db
          .prepare(
            `SELECT party, COUNT(*) AS speeches, COALESCE(SUM(words), 0) AS words, COUNT(DISTINCT pid) AS speakers
             FROM speeches WHERE date BETWEEN ? AND ? GROUP BY party ORDER BY words DESC`,
          )
          .all(period.firstDay, period.lastDay) as Array<{ party: string; speeches: number; words: number; speakers: number }>
      ).map((row) => ({ ...row, speeches: Number(row.speeches), words: Number(row.words), speakers: Number(row.speakers) }));
      const totals = parties.reduce(
        (sum, row) => ({ speeches: sum.speeches + row.speeches, words: sum.words + row.words }),
        { speeches: 0, words: 0 },
      );
      const sittings = (
        this.db.prepare("SELECT COUNT(DISTINCT session_uid) AS n FROM speeches WHERE date BETWEEN ? AND ?").get(period.firstDay, period.lastDay) as {
          n: number;
        }
      ).n;
      const themes = (
        this.db
          .prepare(
            `SELECT ta.theme AS id, COUNT(*) AS speechCount, COUNT(DISTINCT s.pid) AS politicianCount
             FROM theme_attributions ta JOIN speeches s ON s.sid = ta.sid
             WHERE s.date BETWEEN ? AND ?
             GROUP BY ta.theme ORDER BY speechCount DESC`,
          )
          .all(period.firstDay, period.lastDay) as Array<{ id: string; speechCount: number; politicianCount: number }>
      ).map((row) => ({ id: row.id, speechCount: Number(row.speechCount), politicianCount: Number(row.politicianCount) }));
      const common: PhrasesBySize = {};
      for (const n of NGRAM_SIZES) {
        common[String(n)] = this.commonGlobal(n, period);
      }
      const votes = this.db
        .prepare("SELECT COUNT(*) AS n, SUM(is_key) AS keyVotes FROM votes WHERE date BETWEEN ? AND ?")
        .get(period.firstDay, period.lastDay) as { n: number; keyVotes: number | null };
      return {
        period: { from: period.from, to: period.to },
        totals: { ...totals, sittings: Number(sittings), votes: Number(votes.n), keyVotes: Number(votes.keyVotes || 0) },
        chamber,
        parties,
        themes,
        words: { common },
      };
    });
  }
}

let shared: { path: string; mtimeMs: number; analytics: Analytics } | null = null;

// Reopens the database when build_analytics_db.py replaces the file.
export function openAnalytics(path: string): Analytics | null {
  if (!existsSync(path)) {
    return null;
  }
  const mtimeMs = statSync(path).mtimeMs;
  if (shared && shared.path === path && shared.mtimeMs === mtimeMs) {
    return shared.analytics;
  }
  shared?.analytics.close();
  shared = { path, mtimeMs, analytics: new Analytics(path) };
  return shared.analytics;
}
