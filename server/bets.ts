/**
 * Server-side betting, faucet, and seed rotation — all operating on an account's
 * balance. Uses the SAME provably-fair engine and games as the Node tests and
 * the front-end, so every result is reproducible and verifiable by the player.
 */
import { generateServerSeed, hashServerSeed } from "../src/fairness/engine.ts";
import { replay, type AnyBet } from "../src/fairness/verify.ts";
import { BET, FAUCET } from "./config.ts";
import { save, type Account } from "./store.ts";

export class BetError extends Error {}

/** Place a bet, moving the account's balance. Returns result + commitment. */
export function placeBet(acct: Account, spec: AnyBet, stakeLamports: number) {
  if (!Number.isFinite(stakeLamports) || stakeLamports <= 0) {
    throw new BetError("Invalid stake");
  }
  if (stakeLamports < BET.minStakeLamports || stakeLamports > BET.maxStakeLamports) {
    throw new BetError("Stake out of allowed range");
  }
  if (stakeLamports > acct.balanceLamports) {
    throw new BetError("Insufficient balance");
  }

  // Debit the stake up front.
  acct.balanceLamports -= stakeLamports;

  const ctx = {
    serverSeed: acct.serverSeed,
    clientSeed: acct.clientSeed,
    nonce: acct.nonce,
  };
  const result = replay(ctx, spec);

  const payout = Math.floor(stakeLamports * result.multiplier);
  acct.balanceLamports += payout;
  acct.wagered += stakeLamports;
  acct.nonce += 1;
  save(acct);

  return {
    result,
    stakeLamports,
    payoutLamports: payout,
    balanceLamports: acct.balanceLamports,
    // Commitment info so the player can verify after a future rotation.
    nonceUsed: ctx.nonce,
    serverSeedHash: acct.serverSeedHash,
    clientSeed: acct.clientSeed,
  };
}

/** Rotate seeds: reveal the old server seed, commit to a fresh one. */
export function rotateSeed(acct: Account) {
  acct.prevServerSeed = acct.serverSeed; // now revealable for verification
  acct.serverSeed = generateServerSeed();
  acct.serverSeedHash = hashServerSeed(acct.serverSeed);
  acct.nonce = 1;
  save(acct);
  return {
    revealedServerSeed: acct.prevServerSeed,
    newServerSeedHash: acct.serverSeedHash,
  };
}

/** Let the player set their own client seed (provably-fair best practice). */
export function setClientSeed(acct: Account, clientSeed: string) {
  if (typeof clientSeed !== "string" || clientSeed.length < 1 || clientSeed.length > 64) {
    throw new BetError("Client seed must be 1-64 characters");
  }
  acct.clientSeed = clientSeed;
  save(acct);
}

/** Claim free faucet credit, respecting the cooldown. */
export function claimFaucet(acct: Account) {
  const now = Date.now();
  if (acct.lastFaucetAt && now - acct.lastFaucetAt < FAUCET.cooldownMs) {
    const waitMs = FAUCET.cooldownMs - (now - acct.lastFaucetAt);
    throw new BetError(`Faucet on cooldown — try again in ${Math.ceil(waitMs / 60000)} min`);
  }
  acct.balanceLamports += FAUCET.amountLamports;
  acct.lastFaucetAt = now;
  save(acct);
  return {
    creditedLamports: FAUCET.amountLamports,
    balanceLamports: acct.balanceLamports,
    nextClaimAt: now + FAUCET.cooldownMs,
  };
}
