/**
 * Interactive-ish demo: plays one bet of every game from a single committed
 * seed pair, then verifies each one. Run it with:
 *
 *   npm run demo
 *   (or: node src/demo.ts)
 *
 * No blockchain, no network — this is the fairness engine and games running
 * purely locally so you can see and verify every outcome.
 */
import { BRAND } from "./config.ts";
import {
  generateClientSeed,
  generateServerSeed,
  hashServerSeed,
} from "./fairness/engine.ts";
import { verify, type AnyBet } from "./fairness/verify.ts";
import { replay } from "./fairness/verify.ts";
import type { BetContext } from "./games/types.ts";

const serverSeed = generateServerSeed();
const serverSeedHash = hashServerSeed(serverSeed);
const clientSeed = generateClientSeed();

console.log(`\n=== ${BRAND.name} — ${BRAND.tagline} ===\n`);
console.log("Committed BEFORE any bet (player sees this first):");
console.log("  serverSeedHash:", serverSeedHash);
console.log("  clientSeed:    ", clientSeed);
console.log("  (serverSeed stays secret until reveal)\n");

const specs: AnyBet[] = [
  { game: "dice", bet: { target: 50, direction: "under" } },
  { game: "limbo", bet: { target: 2 } },
  { game: "crash", bet: { cashOut: 2 } },
  { game: "mines", bet: { mines: 3, picks: [0, 1, 2, 3, 4] } },
  { game: "plinko", bet: { rows: 16, risk: "medium" } },
  { game: "roulette", bet: { type: "red" } },
  { game: "wheel", bet: { risk: "medium" } },
  { game: "coinflip", bet: { call: "heads" } },
];

let nonce = 1;
for (const spec of specs) {
  const ctx: BetContext = { serverSeed, clientSeed, nonce };
  const result = replay(ctx, spec);
  const tag = result.win ? "WIN " : "LOSS";
  console.log(
    `#${String(nonce).padStart(2)} ${result.game.padEnd(9)} ${tag} ` +
      `x${result.multiplier.toFixed(2).padStart(7)}  ` +
      JSON.stringify(result.outcome),
  );
  nonce++;
}

console.log("\n--- Reveal + verify (player re-checks everything) ---");
console.log("Revealed serverSeed:", serverSeed);

nonce = 1;
let allValid = true;
for (const spec of specs) {
  const ctx: BetContext = { serverSeed, clientSeed, nonce };
  const report = verify(ctx, serverSeedHash, spec);
  if (!report.commitmentValid) allValid = false;
  nonce++;
}
console.log(
  allValid
    ? "✓ Commitment valid for every bet — nothing was tampered with."
    : "✗ Commitment check FAILED.",
);
console.log();
