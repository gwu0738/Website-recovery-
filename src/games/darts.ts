/**
 * Darts — a dart lands in one of several scoring bands, each with a multiplier.
 * One float picks the band by weight. Higher difficulty shifts weight toward the
 * low bands (and a bigger edge), in exchange for the same rare top multiplier.
 *
 * The multipliers mirror the band tiers; the WEIGHTS are our own, tuned so the
 * house keeps a positive edge. Treat the weight tables as tunable config — the
 * fairness engine (which band the dart hits) is untouched.
 */
import { floats } from "../fairness/engine.ts";
import type { BetContext, GameResult } from "./types.ts";

export type DartsDifficulty = "easy" | "medium" | "hard" | "expert";

export const DARTS_MULTIPLIERS = [0.5, 0.8, 1.2, 1.5, 2.7, 8.5];

/** Landing-band weights (probabilities, sum to 1) per difficulty. */
export const DARTS_WEIGHTS: Record<DartsDifficulty, number[]> = {
  easy: [0.38, 0.3, 0.18, 0.08, 0.05, 0.01],
  medium: [0.45, 0.26, 0.15, 0.08, 0.05, 0.01],
  hard: [0.52, 0.22, 0.13, 0.07, 0.05, 0.01],
  expert: [0.58, 0.19, 0.11, 0.06, 0.05, 0.01],
};

export interface DartsBet {
  difficulty: DartsDifficulty;
}

export interface DartsOutcome {
  difficulty: DartsDifficulty;
  band: number;
  multiplier: number;
}

/** Expected return (RTP) for a difficulty — house edge is 1 - RTP. */
export function dartsRtp(difficulty: DartsDifficulty): number {
  const w = DARTS_WEIGHTS[difficulty];
  return w.reduce((acc, wi, i) => acc + wi * DARTS_MULTIPLIERS[i], 0);
}

export function playDarts(ctx: BetContext, bet: DartsBet): GameResult<DartsOutcome> {
  const weights = DARTS_WEIGHTS[bet.difficulty];
  if (!weights) throw new Error("Unknown darts difficulty");
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);

  let acc = 0;
  let band = weights.length - 1;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (u < acc) {
      band = i;
      break;
    }
  }
  const multiplier = DARTS_MULTIPLIERS[band];
  return {
    game: "darts",
    outcome: { difficulty: bet.difficulty, band, multiplier },
    win: multiplier >= 1,
    multiplier,
    houseEdge: 1 - dartsRtp(bet.difficulty),
  };
}
