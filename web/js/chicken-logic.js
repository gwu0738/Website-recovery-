// =============================================================================
// Browser Chicken logic — mirrors src/games/chicken.ts for DEMO mode.
// Crash-ladder: each step survives with probability p (by difficulty).
// =============================================================================
import { floats } from "./fairness.js";
import { HOUSE_EDGE } from "./config.js";

export const CHICKEN_MAX_STEPS = 24;
export const CHICKEN_SURVIVAL = { easy: 0.86, medium: 0.7, hard: 0.55, expert: 0.4 };

const cFloor2 = (x) => Math.floor(x * 100) / 100;

export function chickenMultiplier(difficulty, steps, edge = HOUSE_EDGE) {
  if (steps <= 0) return 1;
  const p = CHICKEN_SURVIVAL[difficulty];
  return cFloor2((1 / Math.pow(p, steps)) * (1 - edge));
}

export function chickenMaxMultiplier(difficulty) {
  return chickenMultiplier(difficulty, CHICKEN_MAX_STEPS);
}

/** Survive/die for every step, fixed by the seed (true = survive). Async. */
export async function chickenLayout(ctx, difficulty) {
  const p = CHICKEN_SURVIVAL[difficulty];
  const fs = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, CHICKEN_MAX_STEPS);
  return fs.map((f) => f < p);
}
