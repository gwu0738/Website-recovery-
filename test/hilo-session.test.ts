// HiLo as a streak session: the card stream is fixed by the seed, right calls
// multiply by the exact odds, a wrong call busts, cashout pays once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VANTA_DATA_DIR = mkdtempSync(join(tmpdir(), "vanta-hilo-"));

const { getOrCreateAccount, getAccount, save, activeSessions } = await import("../server/store.ts");
const { hiloStart, hiloGuess, hiloCashout, hiloCardStream, hiloCallMultiplier, hiloResumeView } =
  await import("../server/hilo-session.ts");

function fund(pubkey: string, lamports: number) {
  const a = getOrCreateAccount(pubkey);
  a.balanceLamports = lamports;
  save(a);
  return getAccount(pubkey)!;
}

test("hilo session: calls follow the seed's card stream and pay exact odds", () => {
  const a = fund("CardShark", 10_000_000);
  const stream = hiloCardStream({ serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: a.nonce });
  const s = hiloStart(a, 1_000_000);
  assert.deepEqual(s.base, stream[0]);
  assert.equal(getAccount("CardShark")!.balanceLamports, 9_000_000);
  const view = hiloResumeView(activeSessions("CardShark")[0]);
  assert.equal(view.cards.length, 1, "only the dealt card is visible");

  // Always call the side that the next card actually satisfies (we know the stream):
  // the multiplier must then be the product of each call's exact odds.
  let expected = 1;
  let i = 0;
  for (; i < 3; i++) {
    const base = stream[i].rank, next = stream[i + 1].rank;
    const guess = next >= base ? "higherOrSame" : "lowerOrSame";
    const r = hiloGuess(a, s.sessionId, guess);
    assert.equal(r.win, true);
    assert.deepEqual(r.card, stream[i + 1]);
    expected = Math.floor(expected * hiloCallMultiplier(base, guess) * 100) / 100;
    assert.equal(r.multiplier, expected);
  }
  const c = hiloCashout(a, s.sessionId);
  assert.equal(c.multiplier, expected);
  assert.equal(getAccount("CardShark")!.balanceLamports, 9_000_000 + Math.floor(1_000_000 * expected + 1e-6));
  assert.throws(() => hiloCashout(a, s.sessionId), /already finished/);
});

test("hilo session: a wrong call loses the stake", () => {
  const a = fund("WrongCall", 10_000_000);
  const stream = hiloCardStream({ serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: a.nonce });
  const s = hiloStart(a, 2_000_000);
  const base = stream[0].rank, next = stream[1].rank;
  if (base === next) {
    // "or same" can't lose on a tie: make a right call, then test the next pair.
    hiloGuess(a, s.sessionId, "higherOrSame");
  }
  const b = base === next ? stream[1].rank : base, n = base === next ? stream[2].rank : next;
  if (b === n) return; // extremely unlikely twice; nothing to assert
  const wrong = n > b ? "lowerOrSame" : "higherOrSame";
  const r = hiloGuess(a, s.sessionId, wrong);
  assert.equal(r.bust, true);
  assert.equal(getAccount("WrongCall")!.balanceLamports, 8_000_000);
  assert.throws(() => hiloCashout(a, s.sessionId), /already finished/);
  assert.throws(() => hiloGuess(a, s.sessionId, "zig" as any), /already finished|Call/);
});
