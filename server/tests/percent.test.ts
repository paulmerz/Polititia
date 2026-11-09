import assert from "node:assert/strict";
import test from "node:test";
import { percentText } from "../src/percent.ts";

test("a share that is not whole never reads as 100 % or 0 %", () => {
  // Mme Dogor-Such: 4 248 votes with her group out of 4 263.
  assert.equal(percentText(4248 / 4263), "99,6 %");
  assert.equal(percentText(0.99999), "99,99 %");
  assert.equal(percentText(0.003), "0,3 %");
  assert.equal(percentText(1), "100 %");
  assert.equal(percentText(0), "0 %");
  assert.equal(percentText(0.874), "87 %");
});
