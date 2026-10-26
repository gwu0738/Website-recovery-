// Tower stateful-session tests: start -> reveal -> cashout, and the bust path.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VANTA_DATA_DIR = mkdtempSync(join(tmpdir(), "vanta-tower-"));

const { getOrCreateAccount, save, getAccount } = await import("../server/store.ts");
const { towerStart, towerReveal, towerCashout } = await import("../server/tower-session.ts");
const { towerLayout, towerMultiplier } = await import("../src/games/tower.ts");

const PK = "TowerTester1111";
let safeRow0: number;

before(() => {
  const a = getOrCreateAccount(PK);
  a.balanceLamports = 100_000_000; // 0.1
  save(a);
  // Layout is fixed by the account's seed at nonce=1 (start consumes it).
  const layout = towerLayout(
    { serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: a.nonce },
    "medium",
  );
  safeRow0 = [0, 1, 2, 3].find((t) => !layout[0].includes(t))!;
});

test("tower start debits stake and opens a session", () => {
  const a = getAccount(PK)!;
  const before = a.balanceLamports;
  const s = towerStart(a, "medium", 2_000_000);
  assert.ok(s.sessionId);
  assert.equal(s.currentMultiplier, 1);
  assert.equal(s.balanceLamports, before - 2_000_000);
  assert.equal(s.cols, 4);
});

test("revealing a safe tile climbs; cashout pays stake * multiplier", () => {
  const a = getAccount(PK)!;
  const stake = 2_000_000;
  const startBal = a.balanceLamports;
  const s = towerStart(a, "medium", stake);

  // Row 0 safe tile is known from the layout at this session's nonce.
  const layout = towerLayout(
    { serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: s.nonceUsed },
    "medium",
  );
  const safe0 = [0, 1, 2, 3].find((t) => !layout[0].includes(t))!;

  const r = towerReveal(a, s.sessionId, safe0);
  assert.equal(r.safe, true);
  assert.equal(r.rowsClimbed, 1);
  assert.equal(r.multiplier, towerMultiplier("medium", 1));

  const c = towerCashout(a, s.sessionId);
  assert.equal(c.rowsClimbed, 1);
  assert.equal(c.payoutLamports, Math.floor(stake * towerMultiplier("medium", 1)));
  // Net: -stake +payout from the balance before this session started.
  assert.equal(c.balanceLamports, startBal - stake + c.payoutLamports);
});

test("revealing a trap busts the session with no payout", () => {
  const a = getAccount(PK)!;
  const stake = 1_000_000;
  const balBefore = a.balanceLamports;
  const s = towerStart(a, "hard", stake); // hard = 3 traps of 4, easy to hit

  const layout = towerLayout(
    { serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: s.nonceUsed },
    "hard",
  );
  const trap0 = layout[0][0];

  const r = towerReveal(a, s.sessionId, trap0);
  assert.equal(r.bust, true);
  assert.equal(r.multiplier, 0);
  // Stake was debited at start and not returned.
  assert.equal(r.balanceLamports, balBefore - stake);
  // Session is closed now.
  assert.throws(() => towerCashout(a, s.sessionId));
});
