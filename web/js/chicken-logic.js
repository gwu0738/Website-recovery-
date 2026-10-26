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

// Top-down Fisher-Yates (same as src/games/shared.ts shuffleTopDown): step i
// uses float i, swapping position i with floor(f[i] * (i + 1)).
function chickenShuffle(items, fs) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(fs[i] * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The lane (1..20) the chicken is caught on, fixed by the seed. Async. */
export async function chickenDeathPoint(ctx, difficulty) {
  const k = CHICKEN_HAZARDS[difficulty];
  const fs = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, CHICKEN_LANES);
  const lanes = Array.from({ length: CHICKEN_LANES }, (_, i) => i + 1);
  return Math.min(...chickenShuffle(lanes, fs).slice(0, k));
}
