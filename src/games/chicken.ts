/**
 * Chicken — a crash-ladder. The chicken takes steps forward; each step raises
 * the multiplier but has a chance of ending the run ("getting hit"). The player
 * picks how many steps to attempt (their cash-out point) and wins if the chicken
 * survives all of them.
 *
 * Each step survives with probability `p` (set by difficulty). The survive/die
 * sequence is provably-fair from the bet's floats. Multiplier after n surviving
 * steps is (1 - houseEdge) / p^n, so the edge is exact.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2 } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export type ChickenDifficulty = "easy" | "medium" | "hard" | "expert";

/** Per-step survival probability by difficulty (lower = riskier, pays more). */
export const CHICKEN_SURVIVAL: Record<ChickenDifficulty, number> = {
  easy: 0.86,
  medium: 0.7,
  hard: 0.55,
  expert: 0.4,
};

export const CHICKEN_MAX_STEPS = 24;

export interface ChickenBet {
  difficulty: ChickenDifficulty;
  /** Number of steps to attempt before cashing out (>= 1). */
  steps: number;
}

export interface ChickenOutcome {
  difficulty: ChickenDifficulty;
  steps: number;
  survivedSteps: number;
  bust: boolean;
}

export function chickenMultiplier(
  difficulty: ChickenDifficulty,
  steps: number,
  houseEdge = HOUSE_EDGE,
): number {
  if (steps <= 0) return 1;
  const p = CHICKEN_SURVIVAL[difficulty];
  return floor2((1 / Math.pow(p, steps)) * (1 - houseEdge));
}

export function playChicken(
  ctx: BetContext,
  bet: ChickenBet,
  houseEdge = HOUSE_EDGE,
): GameResult<ChickenOutcome> {
  const p = CHICKEN_SURVIVAL[bet.difficulty];
  if (p === undefined) throw new Error("Unknown chicken difficulty");
  if (bet.steps < 1 || bet.steps > CHICKEN_MAX_STEPS) {
    throw new Error(`Chicken steps must be 1..${CHICKEN_MAX_STEPS}`);
  }
  const fs = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, bet.steps);
  let survivedSteps = 0;
  let bust = false;
  for (let i = 0; i < bet.steps; i++) {
    if (fs[i] < p) survivedSteps++;
    else {
      bust = true;
      break;
    }
  }
  const win = !bust;
  return {
    game: "chicken",
    outcome: { difficulty: bet.difficulty, steps: bet.steps, survivedSteps, bust },
    win,
    multiplier: win ? chickenMultiplier(bet.difficulty, bet.steps, houseEdge) : 0,
    houseEdge,
  };
}
