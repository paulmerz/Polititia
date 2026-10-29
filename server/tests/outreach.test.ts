import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openAnalytics } from "../src/analytics.ts";
import { loadDashboardData } from "../src/data.ts";
import {
  amoContact,
  amoSittingDeputies,
  departmentDossiers,
  deputyCsv,
  DEPUTY_COLUMNS,
  DEPUTY_TEMPLATE,
  outreachRows,
  pressIndexCsv,
  slugify,
} from "../src/outreach.ts";
import { ALICES, BOB, buildAnalyticsFixture } from "./analytics-fixture.ts";

const BASE = "https://polititia.example";

function actorFile(dir: string, uid: string, ident: Record<string, string>, emails: string[], seat: Record<string, unknown> | null) {
  const acteur = {
    uid: { "#text": uid },
    etatCivil: { ident },
    adresses: { adresse: emails.map((valElec) => ({ type: "15", valElec })) },
    mandats: { mandat: seat ? [{ typeOrgane: "ASSEMBLEE", legislature: "17", dateFin: null, ...seat }] : [] },
  };
  writeFileSync(path.join(dir, `${uid}.json`), JSON.stringify({ acteur }));
}

function fixtures() {
  const analytics = openAnalytics(buildAnalyticsFixture());
  assert.ok(analytics);
  const bundle = loadDashboardData(path.resolve(import.meta.dirname, "..", "fixtures", "dashboard-data.json"));
  const amo = mkdtempSync(path.join(tmpdir(), "polititia-amo-"));
  actorFile(amo, "PA1", { civ: "Mme", prenom: "Alice", nom: "Zéro (Gironde)" }, ["alice@mairie.example", "alice.zero@assemblee-nationale.fr"], {
    election: { lieu: { departement: "Gironde", numCirco: "1" } },
  });
  actorFile(amo, "PA13", { civ: "M.", prenom: "Bob", nom: "Bobby" }, ["bob@example.org"], { election: { lieu: { departement: "Gironde", numCirco: "4" } } });
  actorFile(amo, "PA99", { civ: "M.", prenom: "Nouveau", nom: "Suppléant" }, [], { election: { lieu: { departement: "Gironde", numCirco: "5" } } });
  actorFile(amo, "PA12", { civ: "M.", prenom: "Ancien", nom: "Député" }, ["ancien@assemblee-nationale.fr"], null);
  return { analytics, bundle, amo };
}

test("AMO contacts prefer the Assemblée address and drop the namesake suffix", () => {
  const { amo } = fixtures();
  assert.deepEqual(amoContact(amo, "PA1"), { civility: "Mme", firstName: "Alice", lastName: "Zéro", email: "alice.zero@assemblee-nationale.fr" });
  assert.equal(amoContact(amo, "PA13")?.email, "bob@example.org", "falls back to the only address");
  assert.equal(amoContact(amo, "PA404"), null);
  assert.deepEqual(
    amoSittingDeputies(amo).map((deputy) => deputy.acteurId).sort(),
    ["PA1", "PA13", "PA99"],
    "a deputy whose mandate ended is not sitting",
  );
});

test("the mail-merge file has one row per sitting deputy with their own figures", () => {
  const { analytics, bundle, amo } = fixtures();
  const rows = outreachRows(analytics, bundle, BASE, (id) => amoContact(amo, id));
  assert.deepEqual(
    rows.map((row) => row.id),
    [ALICES[0], ALICES[1], BOB, ALICES[2], ALICES[3], ALICES[4]],
    "sorted by department then constituency; former deputies, ministers and seatless speakers are left out",
  );
  const alice = rows[0];
  assert.equal(alice.salutation, "Madame la Députée", "civility comes from AMO");
  assert.equal(alice.email, "alice.zero@assemblee-nationale.fr");
  assert.equal(alice.circoLabel, "1re circonscription");
  assert.ok(alice.speeches > 0);
  assert.match(alice.hook, /^Vous êtes intervenue \d+ fois en séance\./);
  const link = new URL(alice.link);
  assert.equal(link.searchParams.get("depute"), ALICES[0]);
  assert.equal(link.searchParams.get("utm_campaign"), "lancement-deputes");
  assert.equal(rows.find((row) => row.dept === "099")?.deptName, "Français établis hors de France");
  assert.equal(rows.find((row) => row.id === ALICES[1])?.email, "", "no AMO file: no address, but the row stays");

  const csv = deputyCsv(rows);
  assert.ok(csv.startsWith("\ufeff"), "Excel needs the byte order mark to read UTF-8");
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines[0], DEPUTY_COLUMNS.join(";"));
  assert.equal(lines.length, rows.length + 1);
  for (const column of DEPUTY_TEMPLATE.matchAll(/\{\{(\w+)\}\}/g)) {
    assert.ok(DEPUTY_COLUMNS.includes(column[1]), `template field ${column[1]} is a CSV column`);
  }
});

test("press dossiers group the deputies of each department", () => {
  const { analytics, bundle, amo } = fixtures();
  const rows = outreachRows(analytics, bundle, BASE, (id) => amoContact(amo, id));
  const dossiers = departmentDossiers(rows, analytics, BASE);
  assert.deepEqual(
    dossiers.map((dossier) => dossier.file),
    ["33-gironde.md", "75-paris.md", "099-francais-etablis-hors-de-france.md"],
  );
  const gironde = dossiers.find((dossier) => dossier.dept === "33");
  assert.ok(gironde);
  assert.match(gironde.markdown, /^# Gironde : ce que disent vos députés/);
  assert.match(gironde.markdown, /\| 1re \| Alice Zéro \| LFI-NFP \|/);
  assert.match(gironde.markdown, /utm_campaign=pqr-33/);
  assert.match(gironde.headline, /parmi les 3 députés du département/);
  const index = pressIndexCsv(dossiers, rows).slice(1).split("\r\n");
  assert.equal(index[0], "code;departement;deputes;fichier;titre_suggere");
  assert.ok(index.some((line) => line.startsWith("33;Gironde;3;pqr/33-gironde.md;")));
  assert.equal(slugify("Côtes-d'Armor"), "cotes-d-armor");
});
