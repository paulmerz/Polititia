import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { addDays, agendaView, downloadAgenda, openAgenda, parisToday } from "../src/agenda.ts";
import { renderAgenda } from "../src/agenda-page.ts";
import { openAnalytics } from "../src/analytics.ts";
import { loadConfig } from "../src/config.ts";
import { loadDashboardData } from "../src/data.ts";
import { analyticsFixturePath, startTestApp } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA = readFileSync(path.join(ROOT, "agenda_schema.sql"), "utf8");
const BUNDLE = path.join(ROOT, "server", "fixtures", "dashboard-data.json");

// Dates relative to today, since the pages read the agenda from today on.
function buildAgendaFixture(today: string): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "polititia-agenda-")), "agenda.sqlite");
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const tomorrow = addDays(today, 1);
  const later = addDays(today, 2);
  const meta = {
    built_at: "2026-11-17T05:40:00Z",
    last_confirmed_sitting: tomorrow,
    counts: { sittings: 3, committee_meetings: 2 },
  };
  const insertMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  for (const [key, value] of Object.entries(meta)) {
    insertMeta.run(key, JSON.stringify(value));
  }
  const meeting = db.prepare(`INSERT INTO meetings VALUES (${Array(16).fill("?").join(", ")})`);
  const sitting = (uid: string, day: string, organType = "ASSEMBLEE") =>
    meeting.run(uid, "seance", "confirme", day, `${day}T15:00:00+01:00`, "", "PO1", "Assemblée nationale", "AN", organType, "", "", "50", 1, 1, "[]");
  sitting("RUANR5L17S2026IDS1", tomorrow);
  sitting("RUANR5L17S2026IDS0", addDays(today, -1));
  sitting("RUSNR5L17S2026IDS9", tomorrow, "SENAT");
  const topics = JSON.stringify(["– Audition du directeur", "Examen du rapport", "Nomination", "Questions diverses"]);
  meeting.run("RUANR5L17S2026IDC1", "commission", "confirme", later, `${later}T09:30:00+01:00`, "", "PO2", "Commission des affaires sociales", "Affaires sociales", "COMPER", "", "", "", 0, 1, topics);
  meeting.run("RUANR5L17S2026IDC2", "commission", "annule", later, `${later}T11:00:00+01:00`, "", "PO2", "Commission des affaires sociales", "Affaires sociales", "COMPER", "", "", "", 0, 0, "[]");
  meeting.run("RUANR5L17S2026IDC3", "commission", "confirme", later, `${later}T13:00:00+01:00`, "", "PO3", "Groupe d'amitié France-Italie", "Italie", "GA", "", "", "", 0, 0, "[\"Déjeuner\"]");

  const item = db.prepare("INSERT INTO agenda_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  item.run("PT1", "RUANR5L17S2026IDS1", 1, "confirme", "Questions au Gouvernement", "Questions au Gouvernement", "", "", "");
  item.run("PT2", "RUANR5L17S2026IDS1", 2, "confirme", "Suite de la discussion", "Suite de la discussion de la proposition de loi <b>fin de vie</b>", "", "ODJPR", "");
  item.run("PT3", "RUANR5L17S2026IDS1", 3, "eventuel", "Vote solennel", "Vote solennel sur le projet de loi nouveau", "procédure d'examen simplifiée-Article 103", "", "");
  item.run("PT4", "RUANR5L17S2026IDS1", 4, "supprime", "Discussion", "Point retiré", "", "", "");
  item.run("PT0", "RUANR5L17S2026IDS0", 1, "confirme", "Discussion", "Hier", "", "", "");
  const link = db.prepare("INSERT INTO agenda_item_dossiers VALUES (?, ?, ?)");
  link.run("PT2", "DLR1", "Fin de vie");
  link.run("PT3", "DLR2", "Texte nouveau");
  link.run("PT0", "DLR3", "Hier");
  const dossier = db.prepare(`INSERT INTO dossiers VALUES (${Array(13).fill("?").join(", ")})`);
  dossier.run("DLR1", "Fin de vie", "proposition", "assemblee", "Proposition de loi ordinaire", "2025-03-04", "PO2", "Affaires sociales",
    "PA10", "Mme Anne Exemple", "LFI_NFP", 2, JSON.stringify([{ id: "fin-de-vie", label: "Fin de vie" }]));
  dossier.run("DLR2", "Texte nouveau", "projet", "senat", "Projet de loi ordinaire", "2025-10-01", "", "", "", "", "", 0, "[]");
  db.close();
  return file;
}

describe("agenda view", () => {
  const today = "2026-11-17";
  const agenda = openAgenda(buildAgendaFixture(today));
  const analytics = openAnalytics(analyticsFixturePath());
  assert.ok(agenda && analytics);
  const view = agendaView(agenda, analytics, today);

  test("keeps the Assembly's announced sittings and confirmed committee meetings", () => {
    assert.deepEqual(view.days.map((day) => day.date), ["2026-11-18", "2026-11-19"]);
    const [sittingDay, committeeDay] = view.days;
    assert.equal(sittingDay.sittings.length, 1);
    assert.deepEqual(sittingDay.sittings[0].items.map((entry) => entry.uid), ["PT1", "PT2", "PT3"]);
    assert.equal(sittingDay.sittings[0].items[2].state, "eventuel");
    assert.deepEqual(committeeDay.committees.map((entry) => entry.uid), ["RUANR5L17S2026IDC1"]);
    assert.equal(committeeDay.committees[0].topics.length, 4);
  });

  test("describes each text once, with what Polititia already holds on it", () => {
    assert.deepEqual(view.dossiers.map((card) => card.uid), ["DLR1", "DLR2"]);
    const [known, fresh] = view.dossiers;
    assert.equal(known.author?.name, "Mme Anne Exemple");
    assert.equal(known.memory?.speeches, 3);
    assert.equal(known.memory?.votes, 1);
    assert.deepEqual(known.memory?.keyVotes.map((vote) => vote.number), [101]);
    assert.deepEqual(known.themes, [{ id: "fin-de-vie", label: "Fin de vie", speeches: 3, keyVotes: 1 }]);
    assert.deepEqual(fresh.memory, { speeches: 0, sittings: 0, lastDate: "", votes: 0, keyVotes: [] });
    assert.equal(view.memorySince, analytics.meta.firstDate);
  });

  test("renders facts only, escaped", () => {
    const html = renderAgenda(view, loadDashboardData(BUNDLE));
    assert.match(html, /Suite de la discussion de la proposition de loi &lt;b&gt;fin de vie&lt;\/b&gt;/);
    assert.match(html, /Inscription éventuelle/);
    assert.match(html, /<span class="agenda-badge">Vote solennel<\/span>/);
    assert.match(html, /Procédure d&#39;examen simplifiée \(article 103\)/);
    assert.match(html, /Proposition de loi de Mme Anne Exemple \(<abbr title="[^"]+">LFI-NFP<\/abbr>\) et 2 autres auteurs, déposée le 4 mars 2025/);
    assert.match(html, /Projet de loi du Gouvernement, examiné d’abord par le Sénat, déposé le 1er octobre 2025/);
    assert.match(html, /3 interventions sur ce texte/);
    assert.match(html, /scrutin n° 101/);
    assert.match(html, /Aucune intervention ni aucun scrutin en séance rattachés à ce texte/);
    assert.match(html, /<strong title="Commission des affaires sociales">Affaires sociales<\/strong>/);
    assert.match(html, /et 1 autre point/);
    assert.doesNotMatch(html, /Point retiré|Hier/);
  });
});

describe("agenda download", () => {
  const source = buildAgendaFixture("2026-11-17");
  const respond = (body: Uint8Array, status = 200) => async () => new Response(body, { status });

  test("replaces the file once the download reads back as an agenda", async () => {
    const dest = path.join(mkdtempSync(path.join(os.tmpdir(), "polititia-agenda-dl-")), "agenda.sqlite");
    await downloadAgenda("https://example.org/agenda.sqlite.gz", dest, respond(gzipSync(readFileSync(source))));
    assert.equal(openAgenda(dest)?.meta.builtAt, "2026-11-17T05:40:00Z");
  });

  test("keeps the current file when the download is not an agenda", async () => {
    const dest = path.join(mkdtempSync(path.join(os.tmpdir(), "polititia-agenda-dl-")), "agenda.sqlite");
    writeFileSync(dest, readFileSync(source));
    const before = statSync(dest).size;
    await assert.rejects(downloadAgenda("https://example.org/a.gz", dest, respond(gzipSync(Buffer.from("not a database")))));
    await assert.rejects(downloadAgenda("https://example.org/a.gz", dest, respond(new Uint8Array(), 503)), /HTTP 503/);
    assert.equal(statSync(dest).size, before);
    assert.equal(existsSync(`${dest}.download`), false);
  });
});

describe("agenda configuration", () => {
  test("downloads only from https, and into the data directory", () => {
    const base = { NODE_ENV: "test", DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "polititia-cfg-")) };
    assert.equal(loadConfig(base).agendaUrl, "");
    const config = loadConfig({ ...base, AGENDA_DB_URL: "https://example.org/agenda.sqlite.gz" });
    assert.equal(config.agendaPath, path.join(base.DATA_DIR, "agenda.sqlite"));
    assert.equal(loadConfig({ ...base, AGENDA_DB_URL: "off" }).agendaUrl, "");
    assert.throws(() => loadConfig({ ...base, AGENDA_DB_URL: "http://example.org/a.gz" }), /https/);
  });
});

describe("agenda pages", () => {
  test("/agenda and the home page show the coming texts, without metering", async () => {
    const app = await startTestApp({}, { AGENDA_DB_PATH: buildAgendaFixture(parisToday()) });
    const page = await app.request("/agenda");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Les textes au programme/);
    assert.match(html, /id="texte-DLR1"/);
    const home = await (await app.request("/")).text();
    assert.match(home, /Cette semaine à l’Assemblée/);
    assert.match(home, /href="\/agenda#texte-DLR1"/);
    const quota = await (await app.request("/api/quota")).json();
    assert.equal(quota.quota.used, 0);
  });

  test("say so when the agenda is missing", async () => {
    const app = await startTestApp({}, { AGENDA_DB_PATH: path.join(os.tmpdir(), "polititia-no-agenda.sqlite") });
    assert.match(await (await app.request("/agenda")).text(), /L’agenda n’est pas disponible/);
    assert.doesNotMatch(await (await app.request("/")).text(), /Cette semaine à l’Assemblée/);
  });
});
