import assert from "node:assert/strict";
import { test } from "node:test";
import { ALICES, BOB } from "./analytics-fixture.ts";
import { startTestApp } from "./helpers.ts";

test("the vote catalogue lists public votes, newest first, by theme, key votes or words", async () => {
  const app = await startTestApp();
  const all = await (await app.request("/api/votes")).json();
  assert.equal(all.total, 3);
  assert.deepEqual(all.votes.map((vote: { number: number }) => vote.number), [103, 101, 102]);

  const key = await (await app.request("/api/votes?cles=1")).json();
  assert.deepEqual(key.votes.map((vote: { number: number }) => vote.number), [101, 102]);

  const theme = await (await app.request("/api/votes?theme=fin-de-vie")).json();
  assert.equal(theme.total, 1);
  // A theme is preferred to its domain.
  assert.deepEqual(theme.votes[0].themes, [{ id: "fin-de-vie", label: "Fin de vie" }]);

  const words = await (await app.request("/api/votes?q=transports")).json();
  assert.deepEqual(words.votes.map((vote: { number: number }) => vote.number), [103]);

  assert.equal((await app.request("/api/votes?theme=inconnu")).status, 400);
});

test("a vote gives every listed deputy's position and each group's tally", async () => {
  const app = await startTestApp();
  const vote = await (await app.request("/api/vote/101")).json();
  assert.equal(vote.number, 101);
  assert.equal(vote.adopted, true);
  assert.equal(vote.positions[ALICES[0]], "pour");
  assert.equal(vote.positions[ALICES[11]], "contre");
  assert.equal(vote.positions[BOB], "contre");
  assert.equal(Object.keys(vote.positions).length, 13);
  assert.equal(vote.groupsAtVote[BOB], "RN");
  assert.equal(vote.counts.LFI_NFP.pour, 11);
  assert.equal((await app.request("/api/vote/999")).status, 404);
});

test("looking up votes is not metered", async () => {
  const app = await startTestApp();
  for (let index = 0; index < 12; index += 1) {
    assert.equal((await app.request(`/api/vote/10${index % 3 + 1}`)).status, 200);
  }
  const quota = await (await app.request("/api/quota")).json();
  assert.equal(quota.quota.used, 0);
});
