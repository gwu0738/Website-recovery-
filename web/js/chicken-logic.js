// =============================================================================
// Browser Chicken logic — mirrors src/games/chicken.ts for DEMO mode.
// Death-point model: 20 lanes, k hidden hazards (by difficulty); the chicken is
// caught on the lowest hazard lane.
// =============================================================================
import { floats } from "./fairness.js";
import { HOUSE_EDGE } from "./config.js";

export const CHICKEN_LANES = 20;
export const CHICKEN_HAZARDS = { easy: 1, medium: 3, hard: 5, expert: 10 };

const cFloor2 = (x) => Math.floor(Math.round(x * 1e8) / 1e6) / 100;

export function chickenMaxSteps(difficulty) {
  return CHICKEN_LANES - CHICKEN_HAZARDS[difficulty];
}

export function chickenMultiplier(difficulty, steps, edge = HOUSE_EDGE) {
  if (steps <= 0) return 1;
  const k = CHICKEN_HAZARDS[difficulty];
  let inverseSurvival = 1;
  for (let i = 0; i < steps; i++) {
    inverseSurvival *= (CHICKEN_LANES - i) / (CHICKEN_LANES - i - k);
  }
  return cFloor2(inverseSurvival * (1 - edge));
}

export function chickenMaxMultiplier(difficulty) {
  return chickenMultiplier(difficulty, chickenMaxSteps(difficulty));
}

// Same Fisher-Yates as src/games/shared.ts shuffleIndices, so results match.
function chickenShuffle(n, fs) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor((fs[n - 1 - i] ?? 0) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The lane (1..20) the chicken is caught on, fixed by the seed. Async. */
export async function chickenDeathPoint(ctx, difficulty) {
  const k = CHICKEN_HAZARDS[difficulty];
  const fs = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, CHICKEN_LANES - 1);
  return Math.min(...chickenShuffle(CHICKEN_LANES, fs).slice(0, k)) + 1;
}
