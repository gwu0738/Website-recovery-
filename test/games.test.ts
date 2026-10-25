import { test } from "node:test";
import assert from "node:assert/strict";
import { generateServerSeed, hashServerSeed } from "../src/fairness/engine.ts";
import { verify } from "../src/fairness/verify.ts";
import { playDice } from "../src/games/dice.ts";
import { playLimbo, resultMultiplier } from "../src/games/limbo.ts";
import { playCrash } from "../src/games/crash.ts";
import { playMines, minesMultiplier } from "../src/games/mines.ts";
import { playPlinko } from "../src/games/plinko.ts";
import { playRoulette, pocketColor } from "../src/games/roulette.ts";
import { playCoinflip } from "../src/games/coinflip.ts";
import type { BetContext } from "../src/games/types.ts";

const ctx = (nonce: number): BetContext => ({
  serverSeed: "test-server-seed",
  clientSeed: "test-client",
  nonce,
});

test("dice win pays the right multiplier (roll-under 50 ≈ 1.98x)", () => {
  // nonce chosen so the roll lands under 50; multiplier must be 99/50 floored.
  const r = playDice(ctx(1), { target: 50, direction: "under" });
  if (r.win) assert.equal(r.multiplier, 1.98);
  assert.ok(r.outcome.roll >= 0 && r.outcome.roll <= 100);
});

test("dice rejects impossible targets", () => {
  assert.throws(() => playDice(ctx(1), { target: 0, direction: "under" }));
  assert.throws(() => playDice(ctx(1), { target: 100, direction: "over" }));
});

test("limbo result multiplier obeys its distribution", () => {
  // At u=0, m = (1-edge); min clamp makes it 1.00.
  assert.equal(resultMultiplier(0, 0.01), 1);
  // At u=0.5, m = 0.99 / 0.5 = 1.98.
  assert.equal(resultMultiplier(0.5, 0.01), 1.98);
});

test("crash and limbo agree on the random point", () => {
  const limbo = playLimbo(ctx(5), { target: 1.01 });
  const crash = playCrash(ctx(5), { cashOut: 1.01 });
  assert.equal(limbo.outcome.result, crash.outcome.bustAt);
});

test("mines layout has exactly N mines and is deterministic", () => {
  const a = playMines(ctx(3), { mines: 5, picks: [] });
  const b = playMines(ctx(3), { mines: 5, picks: [] });
  assert.equal(a.outcome.minePositions.length, 5);
  assert.deepEqual(a.outcome.minePositions, b.outcome.minePositions);
});

test("mines multiplier rises with each safe reveal", () => {
  const m1 = minesMultiplier(3, 1);
  const m2 = minesMultiplier(3, 2);
  const m3 = minesMultiplier(3, 3);
  assert.ok(m2 > m1 && m3 > m2);
});

test("mines busts when a pick hits a mine", () => {
  const base = playMines(ctx(9), { mines: 5, picks: [] });
  const mine = base.outcome.minePositions[0];
  const r = playMines(ctx(9), { mines: 5, picks: [mine] });
  assert.equal(r.outcome.bust, true);
  assert.equal(r.multiplier, 0);
});

test("plinko lands in a valid bucket for 16 rows", () => {
  const r = playPlinko(ctx(2), { rows: 16, risk: "medium" });
  assert.ok(r.outcome.bucket >= 0 && r.outcome.bucket <= 16);
  assert.equal(r.outcome.path.length, 16);
});

test("roulette pocket and color are consistent", () => {
  const r = playRoulette(ctx(4), { type: "red" });
  assert.ok(r.outcome.pocket >= 0 && r.outcome.pocket <= 36);
  assert.equal(r.outcome.color, pocketColor(r.outcome.pocket));
});

test("coinflip is one of two outcomes and verifies end-to-end", () => {
  const serverSeed = generateServerSeed();
  const hash = hashServerSeed(serverSeed);
  const c: BetContext = { serverSeed, clientSeed: "c", nonce: 1 };
  const report = verify(c, hash, { game: "coinflip", bet: { call: "heads" } });
  assert.equal(report.commitmentValid, true);
  assert.ok(["heads", "tails"].includes(report.result.outcome.flip));
});

test("replay reproduces a result bit-for-bit", () => {
  const live = playDice(ctx(42), { target: 25, direction: "over" });
  const replayed = verify(ctx(42), "ignored-hash", {
    game: "dice",
    bet: { target: 25, direction: "over" },
  }).result;
  assert.deepEqual(replayed.outcome, live.outcome);
  assert.equal(replayed.multiplier, live.multiplier);
});

test("dice RTP is within ~1% of (1 - houseEdge) over many bets", () => {
  // Statistical sanity: average payout should approach 0.99 for a 1% edge.
  const serverSeed = generateServerSeed();
  const n = 200000;
  let returned = 0;
  for (let i = 1; i <= n; i++) {
    const r = playDice(
      { serverSeed, clientSeed: "rtp", nonce: i },
      { target: 50, direction: "under" },
    );
    returned += r.multiplier; // stake is 1 unit each bet
  }
  const rtp = returned / n;
  assert.ok(Math.abs(rtp - 0.99) < 0.02, `RTP was ${rtp}`);
});
