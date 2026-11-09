import assert from "node:assert/strict";
import test from "node:test";
import { applauseGivers, leaders } from "../src/palmares.ts";

test("leaders: per sitting and in all can differ, and nobody without a count is listed", () => {
  const ranked = leaders([
    { pid: 1, sittings: 395, count: 2226 },
    { pid: 2, sittings: 162, count: 1560 },
    { pid: 3, sittings: 40, count: 0 },
  ]);
  assert.deepEqual(ranked.total.map((row) => row.pid), [1, 2]);
  assert.deepEqual(ranked.perSitting.map((row) => row.pid), [2, 1]);
  assert.equal(ranked.perSitting[0].perSitting, 1560 / 162);
  assert.equal(leaders([{ pid: 1, sittings: 10, count: 5 }, { pid: 2, sittings: 10, count: 4 }], 1).total.length, 1);
});

test("applause givers: share given to another camp, allies apart, non-inscrits left out", () => {
  const givers = applauseGivers(
    [
      { groups: "LFI_NFP,SOC", party: "LFI_NFP", n: 10 },
      { groups: "SOC", party: "EPR", n: 5 },
      { groups: "EPR,DR", party: "DR", n: 4 },
      { groups: "NI", party: "RN", n: 9 },
    ],
    1,
  );
  assert.deepEqual(
    givers.map((row) => [row.party, row.given, row.toOtherCamps, row.toOtherGroups]),
    [
      ["EPR", 4, 4, 4],
      ["SOC", 15, 5, 15],
      ["DR", 4, 0, 0],
      ["LFI_NFP", 10, 0, 0],
    ],
  );
  assert.equal(givers[1].share, 5 / 15);
  assert.deepEqual(applauseGivers([{ groups: "SOC", party: "EPR", n: 5 }]), []);
});
