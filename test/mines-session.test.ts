// Mines as a persistent session: the layout is fixed by the seed (and matches
// the one-shot engine), reveals climb the multiplier, a mine ends it, and
// cashout pays exactly once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VANTA_DATA_DIR = mkdtempSync(join(tmpdir(), "vanta-mines-"));

const { getOrCreateAccount, getAccount, save, activeSessions } = await import("../server/store.ts");
const { minesStart, minesReveal, minesCashout, minesResumeView } = await import("../server/mines-session.ts");
const { playMines, minesMultiplier } = await import("../src/games/mines.ts");

function fund(pubkey: string, lamports: number) {
  const a = getOrCreateAccount(pubkey);
  a.balanceLamports = lamports;
  save(a);
  return getAccount(pubkey)!;
}

test("mines session: layout matches the engine, safe reveals climb, cashout pays once", () => {
  const a = fund("Miner", 10_000_000);
  const ctx = { serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: a.nonce };
  const layout = playMines(ctx, { mines: 3, picks: [] }).outcome.minePositions;
  const s = minesStart(a, 3, 1_000_000);
  assert.equal(s.balanceLamports, 9_000_000, "stake locked");
  assert.equal(s.maxMultiplier, minesMultiplier(3, 22));
  const view = minesResumeView(activeSessions("Miner")[0]);
  assert.equal("minePositions" in view, false, "layout hidden while live");

  const safe = [...Array(25).keys()].filter((t) => !layout.includes(t));
  const r1 = minesReveal(a, s.sessionId, safe[0]);
  assert.equal(r1.safe, true);
  assert.equal(r1.multiplier, minesMultiplier(3, 1));
  assert.throws(() => minesReveal(a, s.sessionId, safe[0]), /already revealed/);
  const r2 = minesReveal(a, s.sessionId, safe[1]);
  assert.equal(r2.multiplier, minesMultiplier(3, 2));

  const c = minesCashout(a, s.sessionId);
  assert.deepEqual(c.minePositions, layout, "layout revealed only once the game is over");
  assert.equal(getAccount("Miner")!.balanceLamports, 9_000_000 + Math.floor(1_000_000 * minesMultiplier(3, 2)));
  assert.throws(() => minesCashout(a, s.sessionId), /already finished/);
});

test("mines session: hitting a mine loses the stake and reveals the layout", () => {
  const a = fund("Unlucky", 10_000_000);
  const ctx = { serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: a.nonce };
  const layout = playMines(ctx, { mines: 5, picks: [] }).outcome.minePositions;
  const s = minesStart(a, 5, 2_000_000);
  const r = minesReveal(a, s.sessionId, layout[0]);
  assert.equal(r.bust, true);
  assert.deepEqual(r.minePositions, layout);
  assert.equal(r.balanceLamports, 8_000_000);
  assert.throws(() => minesCashout(a, s.sessionId), /already finished/);
  assert.throws(() => minesStart(a, 0, 1_000_000), /1-24/);
});
