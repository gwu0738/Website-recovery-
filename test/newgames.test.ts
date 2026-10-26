import { test } from "node:test";
import assert from "node:assert/strict";
import { generateServerSeed } from "../src/fairness/engine.ts";
import { playTower, towerMultiplier } from "../src/games/tower.ts";
import { playHiLo, RANKS } from "../src/games/hilo.ts";
import { playChicken, chickenMultiplier } from "../src/games/chicken.ts";
import { playDarts, dartsRtp, DARTS_MULTIPLIERS, type DartsDifficulty } from "../src/games/darts.ts";
import { playSnakes, snakesRtp } from "../src/games/snakes.ts";
import { playKeno } from "../src/games/keno.ts";
import type { BetContext } from "../src/games/types.ts";

const ctx = (nonce: number): BetContext => ({
  serverSeed: "test-seed",
  clientSeed: "client",
  nonce,
});

const floor2 = (x: number) => Math.floor(x * 100) / 100;

test("tower multiplier rises per row and matches the survival formula", () => {
  // hard = 4 tiles, 1 safe -> survival 1/4 per row -> 1 row = (1/0.25)*0.99 = 3.96
  assert.equal(towerMultiplier("hard", 1), 3.96);
  // medium = 2 safe/4 -> survival 1/2 -> 1 row = (1/0.5)*0.99 = 1.98
  assert.equal(towerMultiplier("medium", 1), 1.98);
  assert.ok(towerMultiplier("hard", 2) > towerMultiplier("hard", 1));
});

test("tower busts when a pick hits a trap; deterministic layout", () => {
  const a = playTower(ctx(3), { difficulty: "medium", picks: [0] });
  const b = playTower(ctx(3), { difficulty: "medium", picks: [0] });
  assert.deepEqual(a.outcome.trapsPerRow, b.outcome.trapsPerRow);
  // Pick the known trap in row 0 -> bust.
  const trap = b.outcome.trapsPerRow[0][0];
  const r = playTower(ctx(3), { difficulty: "medium", picks: [trap] });
  assert.equal(r.outcome.bust, true);
  assert.equal(r.multiplier, 0);
});

test("hilo multiplier matches the probability of the chosen side", () => {
  const r = playHiLo(ctx(5), { guess: "higherOrSame" });
  assert.ok(r.outcome.base >= 0 && r.outcome.base < RANKS);
  if (r.win) {
    const p = (RANKS - r.outcome.base) / RANKS;
    assert.equal(r.multiplier, floor2((1 / p) * 0.99));
  }
});

test("chicken multiplier matches p^n and RTP is ~0.99 over many bets", () => {
  assert.equal(chickenMultiplier("easy", 1), 1.15); // (1/0.86)*0.99 floored
  const serverSeed = generateServerSeed();
  const n = 100000;
  let returned = 0;
  for (let i = 1; i <= n; i++) {
    const r = playChicken(
      { serverSeed, clientSeed: "rtp", nonce: i },
      { difficulty: "medium", steps: 3 },
    );
    returned += r.multiplier;
  }
  const rtp = returned / n;
  assert.ok(Math.abs(rtp - 0.99) < 0.03, `chicken RTP was ${rtp}`);
});

test("darts always keeps a positive house edge and returns a valid band", () => {
  for (const d of ["easy", "medium", "hard", "expert"] as DartsDifficulty[]) {
    assert.ok(dartsRtp(d) < 1, `${d} RTP should be < 1`);
    const r = playDarts(ctx(7), { difficulty: d });
    assert.ok(DARTS_MULTIPLIERS.includes(r.outcome.multiplier));
  }
});

test("snakes keeps a positive edge and a valid outcome", () => {
  assert.ok(snakesRtp() < 1, `snakes RTP should be < 1, was ${snakesRtp()}`);
  const r = playSnakes(ctx(2));
  assert.ok([0, 1.11, 1.4, 2.5, 4.0].includes(r.outcome.multiplier));
});

test("keno draws 10 distinct numbers in 1..40 and counts hits correctly", () => {
  const r = playKeno(ctx(11), { picks: [1, 2, 3, 4, 5] });
  assert.equal(r.outcome.drawn.length, 10);
  assert.equal(new Set(r.outcome.drawn).size, 10);
  assert.ok(r.outcome.drawn.every((n) => n >= 1 && n <= 40));
  const expectedHits = [1, 2, 3, 4, 5].filter((n) => r.outcome.drawn.includes(n)).length;
  assert.equal(r.outcome.hits, expectedHits);
});

test("keno rejects too many picks", () => {
  assert.throws(() => playKeno(ctx(1), { picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }));
});

test("keno is deterministic for the same bet context", () => {
  const a = playKeno(ctx(20), { picks: [7, 14, 21] });
  const b = playKeno(ctx(20), { picks: [7, 14, 21] });
  assert.deepEqual(a.outcome.drawn, b.outcome.drawn);
});
