// Real-balance guarantees: no double-spend from stale account copies, no double
// cashout, every settled bet recorded, and locked stakes surviving a restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DATA = mkdtempSync(join(tmpdir(), "vanta-real-"));
process.env.VANTA_DATA_DIR = DATA;

const { getOrCreateAccount, getAccount, save, myBets } = await import("../server/store.ts");
const { towerStart, towerReveal, towerCashout } = await import("../server/tower-session.ts");
const { chickenStart, chickenStep, chickenCashout } = await import("../server/chicken-session.ts");
const { placeBet } = await import("../server/bets.ts");
const { chickenDeathPoint } = await import("../src/games/chicken.ts");

function fund(pubkey: string, lamports: number) {
  const a = getOrCreateAccount(pubkey);
  a.balanceLamports = lamports;
  save(a);
}

test("two stale copies of one account can't both spend the same balance", () => {
  fund("DoubleSpender", 2_000_000);
  const copy1 = getAccount("DoubleSpender")!; // e.g. loaded by request A
  const copy2 = getAccount("DoubleSpender")!; // e.g. loaded by request B, same moment
  towerStart(copy1, "medium", 2_000_000); // spends everything
  assert.throws(() => towerStart(copy2, "medium", 2_000_000), /Insufficient balance/);
  assert.throws(
    () => placeBet(copy2, { game: "dice", bet: { target: 50, direction: "under" } }, 2_000_000),
    /Insufficient balance/,
  );
  assert.equal(getAccount("DoubleSpender")!.balanceLamports, 0);
});

test("a finished game pays exactly once", () => {
  fund("CashoutTwice", 50_000_000);
  // Find a chicken game that survives lane 1 (deterministic per nonce).
  for (let attempt = 0; attempt < 30; attempt++) {
    const a = getAccount("CashoutTwice")!;
    const dp = chickenDeathPoint(
      { serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: a.nonce },
      "easy",
    );
    const s = chickenStart(a, "easy", 1_000_000);
    const step = chickenStep(a, s.sessionId);
    if (dp === 1) {
      assert.equal(step.bust, true);
      continue;
    }
    const before = getAccount("CashoutTwice")!.balanceLamports;
    const c = chickenCashout(a, s.sessionId);
    assert.equal(getAccount("CashoutTwice")!.balanceLamports, before + c.payoutLamports);
    assert.throws(() => chickenCashout(a, s.sessionId), /already finished/);
    assert.throws(() => chickenStep(a, s.sessionId), /already finished/);
    assert.equal(getAccount("CashoutTwice")!.balanceLamports, before + c.payoutLamports);
    return;
  }
  assert.fail("no surviving chicken game found");
});

test("every settled bet is recorded in history with the right amounts", () => {
  fund("Historian", 50_000_000);
  const a = getAccount("Historian")!;
  const out = placeBet(a, { game: "coinflip", bet: { call: "heads" } }, 1_000_000);
  const s = towerStart(a, "hard", 1_000_000);
  // hard = 3 traps of 4: pick until we bust or clear one row, then settle.
  const r = towerReveal(a, s.sessionId, 0);
  if (!r.bust) towerCashout(a, s.sessionId);

  const bets = myBets("Historian");
  assert.equal(bets.length, 2);
  const flip = bets.find((b) => b.game === "coinflip")!;
  assert.equal(flip.stakeLamports, 1_000_000);
  assert.equal(flip.payoutLamports, out.payoutLamports);
  const tower = bets.find((b) => b.game === "tower")!;
  assert.equal(tower.stakeLamports, 1_000_000);
  assert.equal(tower.payoutLamports, r.bust ? 0 : Math.floor(1_000_000 * r.multiplier));
});

test("a locked stake survives a server restart and the game resumes", () => {
  const root = join(import.meta.dirname, "..");
  const scriptA = join(DATA, "restart-a.mjs");
  const scriptB = join(DATA, "restart-b.mjs");
  // Process A: fund, start a tower game, find a safe tile for row 0, then exit.
  writeFileSync(
    scriptA,
    `const { getOrCreateAccount, save } = await import(${JSON.stringify(pathToFileURL(join(root, "server/store.ts")).href)});
     const { towerStart } = await import(${JSON.stringify(pathToFileURL(join(root, "server/tower-session.ts")).href)});
     const { towerLayout } = await import(${JSON.stringify(pathToFileURL(join(root, "src/games/tower.ts")).href)});
     const a = getOrCreateAccount("Restarter"); a.balanceLamports = 10_000_000; save(a);
     const s = towerStart(a, "easy", 4_000_000);
     const layout = towerLayout({ serverSeed: a.serverSeed, clientSeed: a.clientSeed, nonce: s.nonceUsed }, "easy");
     const safe = [0,1,2,3].find((t) => !layout[0].includes(t));
     console.log(JSON.stringify({ sessionId: s.sessionId, safe, balance: s.balanceLamports }));`,
  );
  // Process B (a "restarted server"): reveal + cash out the same session.
  writeFileSync(
    scriptB,
    `const { getAccount } = await import(${JSON.stringify(pathToFileURL(join(root, "server/store.ts")).href)});
     const { towerReveal, towerCashout } = await import(${JSON.stringify(pathToFileURL(join(root, "server/tower-session.ts")).href)});
     const [sessionId, safe] = process.argv.slice(2);
     const a = getAccount("Restarter");
     const r = towerReveal(a, sessionId, Number(safe));
     const c = towerCashout(a, sessionId);
     console.log(JSON.stringify({ safe: r.safe, payout: c.payoutLamports, balance: getAccount("Restarter").balanceLamports }));`,
  );
  const env = { ...process.env, VANTA_DATA_DIR: DATA, NODE_NO_WARNINGS: "1" };
  const a = JSON.parse(execFileSync(process.execPath, [scriptA], { env }).toString().trim().split("\n").pop()!);
  assert.equal(a.balance, 6_000_000); // stake locked

  const b = JSON.parse(
    execFileSync(process.execPath, [scriptB, a.sessionId, String(a.safe)], { env })
      .toString().trim().split("\n").pop()!,
  );
  assert.equal(b.safe, true);
  assert.ok(b.payout > 4_000_000, "payout should exceed the stake after a safe row");
  assert.equal(b.balance, 6_000_000 + b.payout);
});

test("a sign-in token survives a server restart (sessions are persisted, not in memory)", () => {
  const root = join(import.meta.dirname, "..");
  const scriptA = join(DATA, "auth-a.mjs");
  const scriptB = join(DATA, "auth-b.mjs");
  // Process A: issue a token the way /api/auth/verify does (store it), then exit.
  writeFileSync(
    scriptA,
    `const { insertAuthSession } = await import(${JSON.stringify(pathToFileURL(join(root, "server/store.ts")).href)});
     insertAuthSession("tok-restart-test", "WalletRestart", Date.now() + 60_000);
     console.log("ok");`,
  );
  // Process B (a "restarted server"): the token must still resolve to the wallet.
  writeFileSync(
    scriptB,
    `const { pubkeyForToken } = await import(${JSON.stringify(pathToFileURL(join(root, "server/auth.ts")).href)});
     console.log(JSON.stringify({ pubkey: pubkeyForToken("tok-restart-test"), expired: pubkeyForToken("nope") }));`,
  );
  const env = { ...process.env, VANTA_DATA_DIR: DATA, NODE_NO_WARNINGS: "1" };
  execFileSync(process.execPath, [scriptA], { env });
  const b = JSON.parse(execFileSync(process.execPath, [scriptB], { env }).toString().trim().split("\n").pop()!);
  assert.deepEqual(b, { pubkey: "WalletRestart", expired: null });
});
