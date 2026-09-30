import assert from "node:assert/strict";
import test from "node:test";
import { Analytics, PeriodError } from "../src/analytics.ts";
import { ALICES, BOB, CARLA } from "./analytics-fixture.ts";
import { analyticsFixturePath } from "./helpers.ts";

const analytics = new Analytics(analyticsFixturePath());

test("periods default to the whole corpus and clamp to it", () => {
  assert.deepEqual(analytics.period(), {
    from: "2025-01",
    to: "2025-06",
    firstDay: "2025-01-01",
    lastDay: "2025-06-31",
    isAll: true,
  });
  const clamped = analytics.period("2024-01", "2025-02");
  assert.equal(clamped.from, "2025-01");
  assert.equal(clamped.isAll, false);
  assert.throws(() => analytics.period("2025-1", "2025-02"), PeriodError);
  assert.throws(() => analytics.period("2025-05", "2025-02"), PeriodError);
  assert.throws(() => analytics.period("2030-01", "2030-02"), PeriodError);
});

test("distinctive phrases are ranked by log-odds and carry a ratio", () => {
  const person = analytics.politician(ALICES[0], analytics.period());
  assert.ok(person);
  const distinctive = person.words.distinctive["2"];
  assert.equal(distinctive[0].ngram, "justice fiscale");
  assert.ok((distinctive[0].ratio || 0) > 5);
  assert.ok(!distinctive.some((row) => row.ngram === "projet loi"), "a phrase everyone says is not distinctive");
});

test("a politician's view is limited to the period", () => {
  const march = analytics.politician(ALICES[0], analytics.period("2025-03", "2025-03"));
  assert.ok(march);
  assert.equal(march.activity.speeches, 3);
  assert.deepEqual(
    march.themes.map((theme) => [theme.id, theme.share]),
    [
      ["fin-de-vie", 1],
      ["social", 1],
    ],
  );
  assert.equal(march.excerpts.length, 3);
  assert.match(march.excerpts[0].url, /comptes-rendus\/seance\//);
  const june = analytics.politician(ALICES[0], analytics.period("2025-06", "2025-06"));
  assert.equal(june?.activity.speeches, 0);
  assert.deepEqual(june?.excerpts, []);
});

test("activity rank compares deputies only", () => {
  const top = analytics.politician(ALICES[0], analytics.period());
  assert.ok((top?.activity.moreActiveThan || 0) > 0.8);
  const minister = analytics.politician(CARLA, analytics.period());
  assert.equal(minister?.activity.moreActiveThan, null);
  assert.equal(minister?.roles[0].party, "GOUV");
});

test("group positions come from the tallies and deviations are flagged", () => {
  const rebel = analytics.politician(ALICES[11], analytics.period());
  assert.ok(rebel);
  const key = rebel.votes.list.find((vote) => vote.number === 101);
  assert.ok(key);
  assert.equal(key.groupPosition, "pour", "the declared 'contre' contradicts 11 votes for");
  assert.equal(key.position, "contre");
  assert.equal(key.deviates, true);
  assert.equal(rebel.votes.deviations[0].number, 101);
  assert.match(key.url, /\/scrutins\/101$/);

  const loyal = analytics.politician(ALICES[1], analytics.period());
  assert.equal(loyal?.votes.withGroup, loyal?.votes.comparable);
});

test("censure motions: a group supports it when most members sign", () => {
  const signer = analytics.politician(ALICES[0], analytics.period());
  const censure = signer?.votes.list.find((vote) => vote.number === 102);
  assert.equal(censure?.groupPosition, "pour");
  assert.equal(censure?.deviates, false);
  const bob = analytics.politician(BOB, analytics.period());
  assert.equal(bob?.votes.list.find((vote) => vote.number === 101)?.groups.RN, "contre");
  assert.equal(bob?.votes.absentKey, 0, "not signing a censure motion is not an absence");
  assert.equal(bob?.votes.keyVotesHeld, 1, "censure motions are not counted among the key votes held");
  const nonSigner = analytics.politician(ALICES[8], analytics.period());
  assert.ok(!nonSigner?.votes.list.some((vote) => vote.number === 102));
});

test("theme filter narrows votes and excerpts", () => {
  const person = analytics.politician(ALICES[0], analytics.period(), "securite");
  assert.ok(person);
  assert.equal(person.votes.themeVotes, 1);
  assert.deepEqual(
    person.votes.list.map((vote) => vote.number),
    [103],
  );
  assert.equal(person.votes.deviations[0].number, 103);
  assert.deepEqual(person.excerpts, []);
});

test("theme view: who talks about it, key votes, stances", () => {
  const theme = analytics.theme("fin-de-vie", analytics.period());
  assert.ok(theme);
  assert.equal(theme.stats.speeches, 3);
  assert.equal(theme.ownership[0].party, "LFI_NFP");
  assert.ok(theme.ownership[0].lift > 1);
  assert.deepEqual(Object.keys(theme.politicianScores), [ALICES[0]]);
  assert.equal(theme.keyVotes[0].groups.LFI_NFP, "pour");
  assert.equal(theme.stances[0].party, "LFI_NFP");
  assert.equal(theme.stances[0].level, "favorable");
  assert.equal(analytics.theme("unknown", analytics.period()), null);
});

test("party view: cohesion and distinctive phrases", () => {
  const party = analytics.party("LFI_NFP", analytics.period());
  assert.ok(party);
  assert.equal(party.stats.members, 12);
  assert.ok(party.cohesion && party.cohesion.share > 0.9 && party.cohesion.share < 1);
  assert.ok(Object.values(party.words.distinctive).flat().every((row) => (row.z || 0) >= 1.96));
  assert.equal(analytics.party("RN", analytics.period())?.words.distinctive["1"][0]?.ngram, "sécurité");
  assert.equal(analytics.party("NOPE", analytics.period()), null);
});

test("assembly view: chamber sizes follow the period", () => {
  const all = analytics.assembly(analytics.period());
  const june = analytics.assembly(analytics.period("2025-06", "2025-06"));
  assert.deepEqual(all.chamber[BOB], [3, 360]);
  assert.deepEqual(june.chamber[BOB], [1, 120]);
  assert.deepEqual(june.chamber[ALICES[0]], [0, 0]);
  assert.equal(all.totals.speeches, 19);
  assert.equal(all.words.common["2"][0].ngram, "projet loi");
  assert.equal(june.words.common["1"][0].ngram, "sécurité");
});
