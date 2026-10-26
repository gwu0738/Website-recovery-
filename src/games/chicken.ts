/**
 * Chicken — a road-crossing crash-ladder with a "death point" model.
 *
 * There are 20 lane positions and k hidden hazards (k set by difficulty). The
 * positions are shuffled with the bet's provably-fair floats; the first k are
 * hazards, and the chicken dies on the LOWEST hazard lane (the death point).
 * So it is Mines laid out on a line: the player can cross up to 20 − k lanes.
 *
 * Reaching lane n requires all k hazards to sit beyond n:
 *   P(survive n) = C(20 − n, k) / C(20, k)
 *   multiplier   = (1 − houseEdge) / P(survive n)
 * which makes the edge exact for every cash-out point.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2Safe, shuffleTopDown } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export type ChickenDifficulty = "easy" | "medium" | "hard" | "expert";

export const CHICKEN_LANES = 20;

/** Hidden hazards per difficulty (out of CHICKEN_LANES positions). */
export const CHICKEN_HAZARDS: Record<ChickenDifficulty, number> = {
  easy: 1,
  medium: 3,
  hard: 5,
  expert: 10,
};

/** Lanes a player can cross at this difficulty (20 − hazards). */
export function chickenMaxSteps(difficulty: ChickenDifficulty): number {
  const k = CHICKEN_HAZARDS[difficulty];
  if (k === undefined) throw new Error("Unknown chicken difficulty");
  return CHICKEN_LANES - k;
}

export interface ChickenBet {
  difficulty: ChickenDifficulty;
  /** Number of lanes to cross before cashing out (1 .. maxSteps). */
  steps: number;
}

export interface ChickenOutcome {
  difficulty: ChickenDifficulty;
  steps: number;
  deathPoint: number; // lane the chicken would be caught on
  survivedSteps: number;
  bust: boolean;
}

export function chickenMultiplier(
  difficulty: ChickenDifficulty,
  steps: number,
  houseEdge = HOUSE_EDGE,
): number {
  if (steps <= 0) return 1;
  const k = CHICKEN_HAZARDS[difficulty];
  // C(20,k) / C(20-n,k) as a running product, to avoid big numbers.
  let inverseSurvival = 1;
  for (let i = 0; i < steps; i++) {
    inverseSurvival *= (CHICKEN_LANES - i) / (CHICKEN_LANES - i - k);
  }
  return floor2Safe(inverseSurvival * (1 - houseEdge));
}

export function chickenMaxMultiplier(difficulty: ChickenDifficulty, houseEdge = HOUSE_EDGE): number {
  return chickenMultiplier(difficulty, chickenMaxSteps(difficulty), houseEdge);
}

/** The lane (1..20) the chicken is caught on, fixed by the seed. */
export function chickenDeathPoint(ctx: BetContext, difficulty: ChickenDifficulty): number {
  const k = CHICKEN_HAZARDS[difficulty];
  if (k === undefined) throw new Error("Unknown chicken difficulty");
  // 20 floats; top-down Fisher-Yates over lanes 1..20; caught on the lowest
  // of the first k positions.
  const fs = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, CHICKEN_LANES);
  const lanes = Array.from({ length: CHICKEN_LANES }, (_, i) => i + 1);
  return Math.min(...shuffleTopDown(lanes, fs).slice(0, k));
}

export function playChicken(
  ctx: BetContext,
  bet: ChickenBet,
  houseEdge = HOUSE_EDGE,
): GameResult<ChickenOutcome> {
  const max = chickenMaxSteps(bet.difficulty);
  if (bet.steps < 1 || bet.steps > max) {
    throw new Error(`Chicken steps must be 1..${max}`);
  }
  const deathPoint = chickenDeathPoint(ctx, bet.difficulty);
  const win = bet.steps < deathPoint;
  return {
    game: "chicken",
    outcome: {
      difficulty: bet.difficulty,
      steps: bet.steps,
      deathPoint,
      survivedSteps: Math.min(bet.steps, deathPoint - 1),
      bust: !win,
    },
    win,
    multiplier: win ? chickenMultiplier(bet.difficulty, bet.steps, houseEdge) : 0,
    houseEdge,
  };
}
