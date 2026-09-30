import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirichletLogOdds } from "../src/lexical.ts";

const EXAMPLE = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "log_odds_example.json"), "utf8"),
) as {
  target: Record<string, number>;
  targetTotal: number;
  everyone: Record<string, number>;
  everyoneTotal: number;
  prior: Record<string, number>;
  expected: Record<string, { z: number; ratio: number }>;
};

function runExample() {
  return dirichletLogOdds(
    new Map(Object.entries(EXAMPLE.target)),
    EXAMPLE.targetTotal,
    new Map(Object.entries(EXAMPLE.everyone)),
    EXAMPLE.everyoneTotal,
    new Map(Object.entries(EXAMPLE.prior)),
  );
}

test("matches the Python reference values", () => {
  const rows = new Map(runExample().map((row) => [row.ngram, row]));
  for (const [phrase, expected] of Object.entries(EXAMPLE.expected)) {
    const row = rows.get(phrase);
    assert.ok(row, phrase);
    assert.ok(Math.abs(row.z - expected.z) < 1e-9, `${phrase} z`);
    assert.ok(Math.abs(row.ratio - expected.ratio) < 1e-9, `${phrase} ratio`);
  }
});

test("a frequent signature phrase beats rare and shared ones", () => {
  const phrases = runExample().map((row) => row.ngram);
  assert.equal(phrases[0], "justice fiscale");
  assert.ok(!phrases.includes("mot rare"));
  assert.ok(!phrases.includes("projet de loi"));
});

test("no rest of the corpus gives no rows", () => {
  assert.deepEqual(dirichletLogOdds(new Map([["a", 5]]), 5, new Map([["a", 5]]), 5, new Map([["a", 1]])), []);
});
