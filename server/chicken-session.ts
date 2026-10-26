/**
 * Chicken game sessions — cross lanes one at a time; cash out before you're
 * caught. The death point (the lane you'd be caught on) is fixed at start by
 * the committed seed, so the game needs server-side state.
 *
 * In-memory sessions (see tower-session.ts note) — persist before real money.
 */
import { randomBytes } from "node:crypto";
import {
  chickenDeathPoint,
  chickenMultiplier,
  chickenMaxMultiplier,
  chickenMaxSteps,
  CHICKEN_HAZARDS,
  type ChickenDifficulty,
} from "../src/games/chicken.ts";
import { BET } from "./config.ts";
import { save, type Account } from "./store.ts";

interface ChickenSession {
  id: string;
  pubkey: string;
  difficulty: ChickenDifficulty;
  stakeLamports: number;
  deathPoint: number;
  stepsTaken: number;
  active: boolean;
  nonceUsed: number;
}

const sessions = new Map<string, ChickenSession>();

export class ChickenError extends Error {}

export function chickenStart(acct: Account, difficulty: ChickenDifficulty, stakeLamports: number) {
  if (CHICKEN_HAZARDS[difficulty] === undefined) throw new ChickenError("Unknown difficulty");
  if (!Number.isFinite(stakeLamports) || stakeLamports <= 0) throw new ChickenError("Invalid stake");
  if (stakeLamports < BET.minStakeLamports || stakeLamports > BET.maxStakeLamports) {
    throw new ChickenError("Stake out of allowed range");
  }
  if (stakeLamports > acct.balanceLamports) throw new ChickenError("Insufficient balance");

  const deathPoint = chickenDeathPoint(
    { serverSeed: acct.serverSeed, clientSeed: acct.clientSeed, nonce: acct.nonce },
    difficulty,
  );
  acct.balanceLamports -= stakeLamports;
  acct.wagered += stakeLamports;
  const nonceUsed = acct.nonce;
  acct.nonce += 1;
  save(acct);

  const id = randomBytes(16).toString("hex");
  sessions.set(id, {
    id,
    pubkey: acct.pubkey,
    difficulty,
    stakeLamports,
    deathPoint,
    stepsTaken: 0,
    active: true,
    nonceUsed,
  });

  return {
    sessionId: id,
    difficulty,
    maxSteps: chickenMaxSteps(difficulty),
    maxMultiplier: chickenMaxMultiplier(difficulty),
    currentMultiplier: 1,
    balanceLamports: acct.balanceLamports,
    nonceUsed,
    serverSeedHash: acct.serverSeedHash,
    clientSeed: acct.clientSeed,
  };
}

function owned(acct: Account, sessionId: string): ChickenSession {
  const s = sessions.get(sessionId);
  if (!s || s.pubkey !== acct.pubkey) throw new ChickenError("Session not found");
  if (!s.active) throw new ChickenError("Session already finished");
  return s;
}

export function chickenStep(acct: Account, sessionId: string) {
  const s = owned(acct, sessionId);
  const lane = s.stepsTaken + 1;

  if (lane === s.deathPoint) {
    s.active = false;
    return {
      survived: false,
      bust: true,
      step: s.stepsTaken, // zero-based index of the lane that caught the chicken
      multiplier: 0,
      stepsTaken: s.stepsTaken,
      balanceLamports: acct.balanceLamports,
    };
  }

  s.stepsTaken = lane;
  const multiplier = chickenMultiplier(s.difficulty, s.stepsTaken);
  const completed = s.stepsTaken >= chickenMaxSteps(s.difficulty);
  let payoutLamports = 0;
  if (completed) {
    payoutLamports = Math.floor(s.stakeLamports * multiplier);
    acct.balanceLamports += payoutLamports;
    s.active = false;
    save(acct);
  }
  return {
    survived: true,
    bust: false,
    step: s.stepsTaken - 1,
    multiplier,
    stepsTaken: s.stepsTaken,
    completed,
    payoutLamports,
    balanceLamports: acct.balanceLamports,
  };
}

export function chickenCashout(acct: Account, sessionId: string) {
  const s = owned(acct, sessionId);
  if (s.stepsTaken <= 0) throw new ChickenError("Take at least one step before cashing out");
  const multiplier = chickenMultiplier(s.difficulty, s.stepsTaken);
  const payoutLamports = Math.floor(s.stakeLamports * multiplier);
  acct.balanceLamports += payoutLamports;
  s.active = false;
  save(acct);
  return {
    multiplier,
    stepsTaken: s.stepsTaken,
    payoutLamports,
    balanceLamports: acct.balanceLamports,
  };
}
