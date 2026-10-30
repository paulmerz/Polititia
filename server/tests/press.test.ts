import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openAnalytics } from "../src/analytics.ts";
import { loadDashboardData } from "../src/data.ts";
import { announcedVotes, gapsNote, pressFigures, pressRelease } from "../src/press.ts";
import { ALICES, buildAnalyticsFixture } from "./analytics-fixture.ts";

// The shared fixture has Alice 0 announce a vote in favour on 10 March and
// vote in favour on 12 March. The press tests add, on top of that copy, the
// two cases they need: she later abstains, and another deputy announces a
// vote inside a joint debate.
function pressAnalytics() {
  const file = buildAnalyticsFixture();
  const db = new DatabaseSync(file);
  // The bill's only key vote moves to after the announcement, and Alice 0 abstains on it.
  db.prepare("UPDATE votes SET date = '2025-04-02' WHERE number = 101").run();
  db.prepare("UPDATE vote_positions SET position = 'abstention' WHERE vid = 1 AND pid = 1").run();
  db.prepare("INSERT INTO speeches VALUES (20, 'S20', 2, 'LFI_NFP', '2025-03-11', '2025-03', 'CRSANR5L17S2025O1N200', ?, 'DISC_ARTICLES_3_1', '', 100, 60)").run(
    "Soins palliatifs \u2013 Aide à mourir",
  );
  db.prepare("INSERT INTO theme_attributions VALUES (20, 'fin-de-vie', 'social', 'debate', NULL, '[]', '', 'Fin de vie')").run();
  db.prepare("INSERT INTO stances VALUES (20, 'fin-de-vie', 'defavorable', 0.95, 'rule', 'Nous voterons contre ce texte.')").run();
  db.close();
  const analytics = openAnalytics(file);
  assert.ok(analytics);
  return analytics;
}

test("only comparable announcements count, and a filed correction is reported", () => {
  const analytics = pressAnalytics();
  const bundle = loadDashboardData(path.resolve(import.meta.dirname, "..", "fixtures", "dashboard-data.json"));
  const scrutins = mkdtempSync(path.join(tmpdir(), "polititia-scrutins-"));
  writeFileSync(
    path.join(scrutins, "VTANR5L17V101.json"),
    JSON.stringify({ scrutin: { miseAuPoint: { pour: { votant: { acteurRef: "PA1" } } } } }),
  );

  const { compared, agreeing, gaps } = announcedVotes(analytics, bundle, scrutins);
  assert.deepEqual({ compared, agreeing }, { compared: 1, agreeing: 0 }, "the joint-debate announcement is excluded");
  assert.equal(gaps.length, 1);
  const [gap] = gaps;
  assert.equal(gap.name, "Alice 0");
  assert.equal(gap.stance, "favorable");
  assert.equal(gap.vote.position, "abstention");
  assert.equal(gap.vote.number, 101);
  assert.match(gap.reportUrl, /CRSANR5L17S2025O1N113$/);
  assert.equal(gap.vote.url, "https://www.assemblee-nationale.fr/dyn/17/scrutins/101");
  assert.equal(gap.correction, "filed");

  const figures = pressFigures(analytics, { compared, agreeing });
  assert.ok(figures.speeches > 0 && figures.words > 0 && figures.deputies > 0);
  assert.equal(figures.deputies, ALICES.length + 1, "a minister is not a deputy");

  const release = pressRelease(figures, "https://polititia.example", "2026-11-17");
  assert.match(release, new RegExp(`${agreeing} sur ${compared}`));
  assert.match(release, /utm_source=presse&utm_medium=email&utm_campaign=communique/);
  assert.match(release, /info@maj\.digital/);
  assert.match(release, /MAJ Holding Sàrl/);
  assert.match(release, /Arianna Bianchini/);
  assert.doesNotMatch(release, /\[À compléter/);
  const note = gapsNote(figures, gaps, "https://polititia.example");
  assert.match(note, /s'est abstenu/);
  assert.match(note, /23 jours après l'annonce/);
  assert.match(note, /a déposé une correction de vote/);
  assert.match(note, /« Nous voterons pour ce texte\. »/);
});

test("Bloch's explanation is reproduced next to his case", () => {
  const figures = {
    speeches: 1,
    words: 1,
    deputies: 1,
    sittings: 1,
    firstDate: "2024-07-19",
    lastDate: "2026-10-20",
    compared: 250,
    agreeing: 246,
  };
  const note = gapsNote(
    figures,
    [
      {
        name: "Matthieu Bloch",
        party: "UDR",
        acteurId: "PA840889",
        date: "2026-07-20",
        debate: "Organisation, gestion et financement du sport professionnel",
        quote: "Pour toutes ces raisons, nous nous abstiendrons.",
        stance: "abstention",
        reportUrl: "https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/CRSANR5L17S2026E1N021",
        vote: {
          number: 8418,
          date: "2026-07-20",
          title: "l'ensemble du texte (texte de la commission mixte paritaire).",
          position: "pour",
          url: "https://www.assemblee-nationale.fr/dyn/17/scrutins/8418",
        },
        correction: "none",
      },
      {
        name: "Gérault Verny",
        party: "UDR",
        acteurId: "PA840809",
        date: "2024-11-19",
        debate: "Projet de loi de finances de fin de gestion pour 2024",
        quote: "Notre groupe votera donc contre ce texte.",
        stance: "defavorable",
        reportUrl: "https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/CRSANR5L17S2025O1N047",
        vote: {
          number: 518,
          date: "2024-12-04",
          title: "l'ensemble du projet de loi.",
          position: "pour",
          url: "https://www.assemblee-nationale.fr/dyn/17/scrutins/518",
        },
        correction: "none",
      },
    ],
    "https://polititia.example",
  );
  assert.match(note, /David Desgouilles, au nom de Matthieu Bloch/);
  assert.match(note, /orateur du groupe UDR/);
  assert.match(note, /liberté de vote dont dispose chaque parlementaire/);
  assert.match(note, /Seul David Desgouilles, au nom de Matthieu Bloch, a répondu, le 26 octobre 2026/);
  assert.match(note, /Cette explication est reproduite sous le nom de Matthieu Bloch et doit être citée avec le constat/);
  assert.match(note, /Gérault Verny n'a pas répondu au 30 octobre 2026/);
  assert.match(note, /Aucune réponse reçue au 30 octobre 2026/);
});

test("without the raw scrutin files, corrections are marked unknown", () => {
  const analytics = pressAnalytics();
  const bundle = loadDashboardData(path.resolve(import.meta.dirname, "..", "fixtures", "dashboard-data.json"));
  const { gaps } = announcedVotes(analytics, bundle, null);
  assert.equal(gaps[0].correction, "unknown");
});
