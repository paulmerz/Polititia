import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "analytics_schema.sql"),
  "utf8",
);

export const ALICES = Array.from({ length: 12 }, (_, index) => `m-alice-${index}--lfi-nfp`);
export const BOB = "m-bob--rn";
export const CARLA = "mme-carla--gouv";

type SpeechSpec = { pid: number; party: string; date: string; grams: Record<string, number>; filler?: number };

const NGRAMS: Array<{ gid: number; n: number; text: string }> = [
  { gid: 1, n: 2, text: "justice fiscale" },
  { gid: 2, n: 2, text: "projet loi" },
  { gid: 3, n: 1, text: "retraite" },
  { gid: 4, n: 1, text: "sécurité" },
];

const THEMES = [
  { id: "social", label: "Santé, travail et solidarités", type: "domain", parent: null, committee: "Commission des affaires sociales" },
  { id: "lois", label: "Justice, sécurité et institutions", type: "domain", parent: null, committee: "Commission des lois" },
  { id: "fin-de-vie", label: "Fin de vie", type: "theme", parent: "social", committee: "" },
  { id: "securite", label: "Sécurité et police", type: "theme", parent: "lois", committee: "" },
];

const EXCERPT =
  "Nous défendons une aide à mourir strictement encadrée, avec une procédure collégiale, un délai de réflexion et une clause de conscience pour les soignants.";

// A tiny corpus with known answers: Alice 0 says "justice fiscale" a lot,
// Alice 11 votes against her group on the key vote, Bob is the only RN member.
export function buildAnalyticsFixture(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "polititia-analytics-"));
  const file = path.join(dir, "analytics.sqlite");
  const db = new Database(file);
  db.exec(SCHEMA);

  const politicians = [
    ...ALICES.map((id, index) => ({ pid: index + 1, id, name: `M. Alice ${index}`, party: "LFI_NFP", acteur: `PA${index + 1}` })),
    { pid: 13, id: BOB, name: "M. Bob", party: "RN", acteur: "PA13" },
    { pid: 14, id: CARLA, name: "Mme Carla", party: "GOUV", acteur: "PA14" },
  ];
  const insertPolitician = db.prepare("INSERT INTO politicians VALUES (?, ?, ?, ?, ?)");
  for (const person of politicians) {
    insertPolitician.run(person.pid, person.id, person.name, person.party, person.acteur);
  }

  const speeches: SpeechSpec[] = [];
  ALICES.forEach((_id, index) => {
    speeches.push({ pid: index + 1, party: "LFI_NFP", date: "2025-01-15", grams: { "projet loi": 5, retraite: 2 } });
  });
  for (const day of ["2025-03-10", "2025-03-11", "2025-03-12"]) {
    speeches.push({ pid: 1, party: "LFI_NFP", date: day, grams: { "justice fiscale": 4, "projet loi": 2, retraite: 3 } });
  }
  speeches.push({ pid: 13, party: "RN", date: "2025-02-03", grams: { "projet loi": 6, sécurité: 4 } });
  speeches.push({ pid: 13, party: "RN", date: "2025-02-04", grams: { "projet loi": 4, sécurité: 5, "justice fiscale": 1 } });
  speeches.push({ pid: 13, party: "RN", date: "2025-06-02", grams: { "projet loi": 5, sécurité: 3 } });
  speeches.push({ pid: 14, party: "GOUV", date: "2025-02-05", grams: { "projet loi": 8, retraite: 1 } });

  const gidOf = new Map(NGRAMS.map((row) => [row.text, row]));
  const insertSpeech = db.prepare("INSERT INTO speeches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const person = new Map<string, number>();
  const party = new Map<string, number>();
  const everyone = new Map<string, number>();
  const personTotals = new Map<string, number>();
  const partyTotals = new Map<string, number>();
  const globalTotals = new Map<string, number>();
  const corpus = new Map<number, number>();
  const bump = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) || 0) + value);

  speeches.forEach((speech, index) => {
    const sid = index + 1;
    const month = speech.date.slice(0, 7);
    const filler = speech.filler ?? 40;
    insertSpeech.run(
      sid,
      `S${sid}`,
      speech.pid,
      speech.party,
      speech.date,
      month,
      `CRSANR5L17S2025O1N${String(100 + sid)}`,
      speech.pid === 13 ? "Sûreté dans les transports" : "Droit à l'aide à mourir",
      "DISC_ARTICLES_3_1",
      "",
      filler * 3,
      filler * 2,
    );
    for (const n of [1, 2]) {
      bump(personTotals, `${speech.pid}|${n}|${month}`, filler);
      bump(partyTotals, `${speech.party}|${n}|${month}`, filler);
      bump(globalTotals, `${n}|${month}`, filler);
    }
    for (const [text, count] of Object.entries(speech.grams)) {
      const gram = gidOf.get(text);
      if (!gram) {
        continue;
      }
      bump(person, `${speech.pid}|${gram.n}|${month}|${gram.gid}`, count);
      bump(party, `${speech.party}|${gram.n}|${month}|${gram.gid}`, count);
      bump(everyone, `${gram.gid}|${month}`, count);
      corpus.set(gram.gid, (corpus.get(gram.gid) || 0) + count);
    }
  });

  const insertNgram = db.prepare("INSERT INTO ngrams VALUES (?, ?, ?, ?)");
  for (const gram of NGRAMS) {
    insertNgram.run(gram.gid, gram.n, gram.text, corpus.get(gram.gid) || 0);
  }
  const insertPerson = db.prepare("INSERT INTO person_ngram_month VALUES (?, ?, ?, ?, ?)");
  for (const [key, count] of person) {
    const [pid, n, month, gid] = key.split("|");
    insertPerson.run(Number(pid), Number(n), month, Number(gid), count);
  }
  const insertParty = db.prepare("INSERT INTO party_ngram_month VALUES (?, ?, ?, ?, ?)");
  for (const [key, count] of party) {
    const [code, n, month, gid] = key.split("|");
    insertParty.run(code, Number(n), month, Number(gid), count);
  }
  const insertGlobal = db.prepare("INSERT INTO global_ngram_month VALUES (?, ?, ?)");
  for (const [key, count] of everyone) {
    const [gid, month] = key.split("|");
    insertGlobal.run(Number(gid), month, count);
  }
  const insertPersonTotal = db.prepare("INSERT INTO person_totals VALUES (?, ?, ?, ?)");
  for (const [key, total] of personTotals) {
    const [pid, n, month] = key.split("|");
    insertPersonTotal.run(Number(pid), Number(n), month, total);
  }
  const insertPartyTotal = db.prepare("INSERT INTO party_totals VALUES (?, ?, ?, ?)");
  for (const [key, total] of partyTotals) {
    const [code, n, month] = key.split("|");
    insertPartyTotal.run(code, Number(n), month, total);
  }
  const insertGlobalTotal = db.prepare("INSERT INTO global_totals VALUES (?, ?, ?)");
  const corpusTotals: Record<string, number> = {};
  for (const [key, total] of globalTotals) {
    const [n, month] = key.split("|");
    insertGlobalTotal.run(Number(n), month, total);
    corpusTotals[n] = (corpusTotals[n] || 0) + total;
  }

  const insertTheme = db.prepare("INSERT INTO theme_attributions VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const sid of [13, 14, 15]) {
    insertTheme.run(sid, "fin-de-vie", "social", "debate", null, "[]", EXCERPT, "Fin de vie");
    insertTheme.run(sid, "social", "social", "domain", null, "[]", "", "Fin de vie");
  }
  for (const sid of [16, 17]) {
    insertTheme.run(sid, "securite", "lois", "debate", null, "[]", `${EXCERPT} Et la sécurité dans les transports publics.`, "");
    insertTheme.run(sid, "lois", "lois", "domain", null, "[]", "", "");
  }

  const insertVote = db.prepare("INSERT INTO votes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  // Declared positions contradict the tallies on purpose.
  insertVote.run(
    1,
    "VTANR5L17V1",
    101,
    "2025-03-12",
    "l'ensemble de la proposition de loi relative au droit à l'aide à mourir",
    1,
    "SPS",
    1,
    "Fin de vie",
    JSON.stringify({ LFI_NFP: "contre", RN: "pour" }),
    JSON.stringify({
      _total: { pour: 11, contre: 2, abstention: 0 },
      LFI_NFP: { pour: 11, contre: 1, abstention: 0, members: 12 },
      RN: { pour: 0, contre: 1, abstention: 0, members: 1 },
    }),
  );
  insertVote.run(
    2,
    "VTANR5L17V2",
    102,
    "2025-02-01",
    "la motion de censure déposée en application de l'article 49, alinéa 2",
    0,
    "MOC",
    1,
    "",
    JSON.stringify({ LFI_NFP: "pour", RN: "pour" }),
    JSON.stringify({
      _total: { pour: 7, contre: 0, abstention: 0 },
      LFI_NFP: { pour: 7, contre: 0, abstention: 0, members: 12 },
      RN: { pour: 0, contre: 0, abstention: 0, members: 1 },
    }),
  );
  insertVote.run(
    3,
    "VTANR5L17V3",
    103,
    "2025-06-02",
    "l'amendement n° 12 de M. Bob à l'article 3 du projet de loi relatif à la sûreté dans les transports",
    0,
    "SPO",
    0,
    "",
    JSON.stringify({ LFI_NFP: "pour", RN: "pour" }),
    JSON.stringify({
      _total: { pour: 12, contre: 0, abstention: 1 },
      LFI_NFP: { pour: 11, contre: 0, abstention: 1, members: 12 },
      RN: { pour: 1, contre: 0, abstention: 0, members: 1 },
    }),
  );
  const insertPosition = db.prepare("INSERT INTO vote_positions VALUES (?, ?, ?, ?)");
  ALICES.forEach((_id, index) => {
    insertPosition.run(1, index + 1, "LFI_NFP", index === 11 ? "contre" : "pour");
    if (index < 7) {
      insertPosition.run(2, index + 1, "LFI_NFP", "pour");
    }
    insertPosition.run(3, index + 1, "LFI_NFP", index === 0 ? "abstention" : "pour");
  });
  insertPosition.run(1, 13, "RN", "contre");
  insertPosition.run(3, 13, "RN", "pour");
  const insertVoteTheme = db.prepare("INSERT INTO vote_themes VALUES (?, ?)");
  insertVoteTheme.run(1, "fin-de-vie");
  insertVoteTheme.run(1, "social");
  insertVoteTheme.run(3, "securite");
  insertVoteTheme.run(3, "lois");

  db.prepare("INSERT INTO stances VALUES (?, ?, ?, ?, ?, ?)").run(
    13,
    "fin-de-vie",
    "favorable",
    0.95,
    "rule",
    "Nous voterons pour ce texte.",
  );

  const meta = {
    firstDate: "2025-01-15",
    lastDate: "2025-06-02",
    months: ["2025-01", "2025-02", "2025-03", "2025-06"],
    sessions: [{ id: "session-2024", label: "Session 2024-2025", from: "2025-01-15", to: "2025-09-30" }],
    alpha0: 1000,
    corpusTotals,
    builtOn: "2025-07-01",
    themes: THEMES,
  };
  const insertMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  for (const [key, value] of Object.entries(meta)) {
    insertMeta.run(key, JSON.stringify(value));
  }
  db.close();
  return file;
}
