/**
 * Chicken game sessions — a crash-ladder played step by step. Advance to raise
 * the multiplier; cash out before a step kills the chicken. Like Tower, the
 * survive/die outcome for every step is fixed at start by the committed seed,
 * so it needs server-side state.
 *
 * In-memory sessions (see tower-session.ts note) — persist before real money.
 */
import { randomBytes } from "node:crypto";
import {
  chickenLayout,
  chickenMultiplier,
  chickenMaxMultiplier,
  CHICKEN_MAX_STEPS,
  CHICKEN_SURVIVAL,
  type ChickenDifficulty,
} from "../src/games/chicken.ts";
import { BET } from "./config.ts";
import { save, type Account } from "./store.ts";

interface ChickenSession {
  id: string;
  pubkey: string;
  difficulty: ChickenDifficulty;
  stakeLamports: number;
  survive: boolean[];
  stepsTaken: number;
  active: boolean;
  nonceUsed: number;
}

const sessions = new Map<string, ChickenSession>();

export class ChickenError extends Error {}

export function chickenStart(acct: Account, difficulty: ChickenDifficulty, stakeLamports: number) {
  if (CHICKEN_SURVIVAL[difficulty] === undefined) throw new ChickenError("Unknown difficulty");
  if (!Number.isFinite(stakeLamports) || stakeLamports <= 0) throw new ChickenError("Invalid stake");
  if (stakeLamports < BET.minStakeLamports || stakeLamports > BET.maxStakeLamports) {
    throw new ChickenError("Stake out of allowed range");
  }
  if (stakeLamports > acct.balanceLamports) throw new ChickenError("Insufficient balance");

  const survive = chickenLayout(
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
    survive,
    stepsTaken: 0,
    active: true,
    nonceUsed,
  });

  return {
    sessionId: id,
    difficulty,
    maxSteps: CHICKEN_MAX_STEPS,
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
  const survived = s.survive[s.stepsTaken];

  if (!survived) {
    s.active = false;
    return {
      survived: false,
      bust: true,
      step: s.stepsTaken,
      multiplier: 0,
      stepsTaken: s.stepsTaken,
      balanceLamports: acct.balanceLamports,
    };
  }

  s.stepsTaken += 1;
  const multiplier = chickenMultiplier(s.difficulty, s.stepsTaken);
  const completed = s.stepsTaken >= CHICKEN_MAX_STEPS;
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
