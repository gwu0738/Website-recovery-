/**
 * Chicken sessions on the persistent session framework (server/sessions.ts):
 * start debits the stake and fixes the death point from the committed seed;
 * each step crosses a lane or gets caught; cashout pays stake x multiplier.
 * Stakes survive a server restart and every money movement is transactional.
 */
import {
  chickenDeathPoint,
  chickenMultiplier,
  chickenMaxMultiplier,
  chickenMaxSteps,
  CHICKEN_HAZARDS,
  type ChickenDifficulty,
} from "../src/games/chicken.ts";
import {
  SessionError,
  sessionAct,
  sessionCashout,
  sessionStart,
  type SessionGame,
} from "./sessions.ts";
import type { Account, SessionRow } from "./store.ts";

export { SessionError as ChickenError };

interface ChickenState {
  difficulty: ChickenDifficulty;
  deathPoint: number; // lane that catches the chicken — hidden until the end
  stepsTaken: number;
}

const CHICKEN: SessionGame<ChickenState, ChickenDifficulty, void> = {
  name: "chicken",
  validate(difficulty) {
    if (CHICKEN_HAZARDS[difficulty] === undefined) throw new SessionError("Unknown difficulty");
  },
  init: (ctx, difficulty) => ({
    difficulty,
    deathPoint: chickenDeathPoint(ctx, difficulty),
    stepsTaken: 0,
  }),
  act(s) {
    const lane = s.stepsTaken + 1;
    if (lane === s.deathPoint) return { state: s, bust: true };
    return { state: { ...s, stepsTaken: lane }, bust: false };
  },
  progress: (s) => s.stepsTaken,
  multiplier: (s) => chickenMultiplier(s.difficulty, s.stepsTaken),
  isComplete: (s) => s.stepsTaken >= chickenMaxSteps(s.difficulty),
};

export function chickenStart(acct: Account, difficulty: ChickenDifficulty, stakeLamports: number) {
  const s = sessionStart(CHICKEN, acct, difficulty, stakeLamports);
  return {
    sessionId: s.sessionId,
    difficulty,
    maxSteps: chickenMaxSteps(difficulty),
    maxMultiplier: chickenMaxMultiplier(difficulty),
    currentMultiplier: 1,
    balanceLamports: s.balanceLamports,
    nonceUsed: s.nonceUsed,
    serverSeedHash: s.serverSeedHash,
    clientSeed: s.clientSeed,
  };
}

export function chickenStep(acct: Account, sessionId: string) {
  const r = sessionAct(CHICKEN, acct, sessionId, undefined);
  if (r.bust) {
    return {
      survived: false,
      bust: true,
      step: r.prev.stepsTaken, // zero-based index of the lane that caught it
      multiplier: 0,
      stepsTaken: r.prev.stepsTaken,
      balanceLamports: r.balanceLamports,
    };
  }
  return {
    survived: true,
    bust: false,
    step: r.state.stepsTaken - 1,
    multiplier: r.multiplier,
    stepsTaken: r.state.stepsTaken,
    completed: r.completed,
    payoutLamports: r.payoutLamports,
    balanceLamports: r.balanceLamports,
  };
}

export function chickenCashout(acct: Account, sessionId: string) {
  const r = sessionCashout(CHICKEN, acct, sessionId, "Take at least one step before cashing out");
  return {
    multiplier: r.multiplier,
    stepsTaken: r.state.stepsTaken,
    payoutLamports: r.payoutLamports,
    balanceLamports: r.balanceLamports,
  };
}

/** What the player may see of an unfinished game (never the death point). */
export function chickenResumeView(row: SessionRow) {
  const s = row.state as ChickenState;
  return {
    difficulty: s.difficulty,
    stepsTaken: s.stepsTaken,
    maxSteps: chickenMaxSteps(s.difficulty),
    multiplier: chickenMultiplier(s.difficulty, s.stepsTaken),
    maxMultiplier: chickenMaxMultiplier(s.difficulty),
  };
}
