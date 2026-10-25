import { test } from "node:test";
import assert from "node:assert/strict";
import {
  floats,
  generateServerSeed,
  hashServerSeed,
} from "../src/fairness/engine.ts";
import { verifyCommitment } from "../src/fairness/verify.ts";

test("floats are deterministic for the same inputs", () => {
  const a = floats("server", "client", 1, 10);
  const b = floats("server", "client", 1, 10);
  assert.deepEqual(a, b);
});

test("floats differ when the nonce changes", () => {
  const a = floats("server", "client", 1, 4);
  const b = floats("server", "client", 2, 4);
  assert.notDeepEqual(a, b);
});

test("all floats are in [0, 1)", () => {
  const fs = floats(generateServerSeed(), "client", 7, 1000);
  for (const f of fs) {
    assert.ok(f >= 0 && f < 1, `float out of range: ${f}`);
  }
});

test("floats are roughly uniform (mean near 0.5)", () => {
  const fs = floats(generateServerSeed(), "client", 1, 50000);
  const mean = fs.reduce((a, b) => a + b, 0) / fs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.01, `mean was ${mean}`);
});

test("commitment verifies only for the true server seed", () => {
  const seed = generateServerSeed();
  const hash = hashServerSeed(seed);
  assert.equal(verifyCommitment(seed, hash), true);
  assert.equal(verifyCommitment(generateServerSeed(), hash), false);
});
