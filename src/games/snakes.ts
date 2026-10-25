/**
 * Snakes — roll and land on a prize tier. Most rolls miss (a snake, 0x); the
 * rest pay a tier multiplier. One float picks the outcome by weight.
 *
 * The prize tiers mirror nuts.gg's shown values; the WEIGHTS (including how often
 * you miss) are our own, tuned to ~3% house edge. This is our interpretation of
 * the game — the exact distribution isn't public. Weights are tunable config.
 */
import { floats } from "../fairness/engine.ts";
import type { BetContext, GameResult } from "./types.ts";

// Outcome multipliers (0 = hit a snake) and their weights (sum to 1).
export const SNAKES_OUTCOMES = [
  { multiplier: 0, weight: 0.275 },
  { multiplier: 1.11, weight: 0.48 },
  { multiplier: 1.4, weight: 0.18 },
  { multiplier: 2.5, weight: 0.05 },
  { multiplier: 4.0, weight: 0.015 },
];

export interface SnakesOutcome {
  index: number;
  multiplier: number;
}

/** Expected return (RTP); house edge is 1 - RTP. */
export function snakesRtp(): number {
  return SNAKES_OUTCOMES.reduce((acc, o) => acc + o.weight * o.multiplier, 0);
}

export function playSnakes(ctx: BetContext): GameResult<SnakesOutcome> {
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  let acc = 0;
  let index = SNAKES_OUTCOMES.length - 1;
  for (let i = 0; i < SNAKES_OUTCOMES.length; i++) {
    acc += SNAKES_OUTCOMES[i].weight;
    if (u < acc) {
      index = i;
      break;
    }
  }
  const multiplier = SNAKES_OUTCOMES[index].multiplier;
  return {
    game: "snakes",
    outcome: { index, multiplier },
    win: multiplier >= 1,
    multiplier,
    houseEdge: 1 - snakesRtp(),
  };
}
