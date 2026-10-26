// Chicken stateful-session tests: start -> step -> cashout, matching the
// seed-fixed death point.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VANTA_DATA_DIR = mkdtempSync(join(tmpdir(), "vanta-chk-"));

const { getOrCreateAccount, save, getAccount } = await import("../server/store.ts");
const { chickenStart, chickenStep, chickenCashout } = await import("../server/chicken-session.ts");
const { chickenDeathPoint, chickenMultiplier } = await import("../src/games/chicken.ts");

const PK = "ChickenTester1";

before(() => {
  const a = getOrCreateAccount(PK);
  a.balanceLamports = 100_000_000;
  save(a);
});

test("chicken start debits stake and returns a session", () => {
  const a = getAccount(PK)!;
  const before = a.balanceLamports;
  const s = chickenStart(a, "easy", 2_000_000);
  assert.ok(s.sessionId);
  assert.equal(s.currentMultiplier, 1);
  assert.equal(s.balanceLamports, before - 2_000_000);
});

test("a step matches the seed-fixed layout; cashout pays when survived", () => {
  const a = getAccount(PK)!;
  const stake = 2_000_000;
  const startBal = a.balanceLamports;
  const s = chickenStart(a, "easy", stake);
  const deathPoint = chickenDeathPoint(
    { serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: s.nonceUsed },
    "easy",
  );
  const survivesLane1 = deathPoint > 1;

  const r = chickenStep(a, s.sessionId);
  assert.equal(r.survived, survivesLane1);

  if (survivesLane1) {
    assert.equal(r.multiplier, chickenMultiplier("easy", 1));
    const c = chickenCashout(a, s.sessionId);
    assert.equal(c.payoutLamports, Math.floor(stake * chickenMultiplier("easy", 1)));
    assert.equal(c.balanceLamports, startBal - stake + c.payoutLamports);
  } else {
    assert.equal(r.bust, true);
    assert.equal(r.balanceLamports, startBal - stake);
    assert.throws(() => chickenCashout(a, s.sessionId));
  }
});
