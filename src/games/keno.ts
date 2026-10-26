/**
 * Keno — pick 1..10 numbers on a 40-number grid. The game draws 10 numbers; you
 * are paid by how many of your picks are hit, per a paytable keyed by how many
 * you picked.
 *
 * The 10 numbers are drawn one at a time: each float picks one of the numbers
 * still remaining in 1..40.
 *
 * KENO_PAYTABLE below is illustrative "classic risk" and should be RTP-tuned
 * against the hypergeometric odds before real-money use. The mechanics (draw and
 * hit-count) are exact and tested; only the payout numbers are tunable config.
 */
import { floats } from "../fairness/engine.ts";
import { pickSequential } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export const KENO_POOL = 40;
export const KENO_DRAW = 10;
export const KENO_MAX_PICKS = 10;

/** KENO_PAYTABLE[picks][hits] = multiplier (index 0..picks). Illustrative. */
export const KENO_PAYTABLE: Record<number, number[]> = {
  1: [0, 3.9],
  2: [0, 1.9, 4.5],
  3: [0, 1, 3.1, 10.4],
  4: [0, 0.8, 1.8, 5, 22.5],
  5: [0, 0.3, 1.5, 4, 13, 48],
  6: [0, 0, 1, 3.5, 7, 15, 100],
  7: [0, 0, 0.5, 2, 6, 12, 50, 180],
  8: [0, 0, 0.3, 1.5, 4, 9, 25, 100, 500],
  9: [0, 0, 0.2, 1.3, 3, 6, 15, 60, 250, 1000],
  10: [0, 0, 0, 1.2, 2.5, 5, 12, 45, 150, 600, 2500],
};

export interface KenoBet {
  /** 1..10 distinct numbers in 1..40. */
  picks: number[];
}

export interface KenoOutcome {
  picks: number[];
  drawn: number[];
  hits: number;
}

export function playKeno(ctx: BetContext, bet: KenoBet): GameResult<KenoOutcome> {
  const picks = [...new Set(bet.picks)];
  if (picks.length < 1 || picks.length > KENO_MAX_PICKS) {
    throw new Error("Keno: pick 1..10 numbers");
  }
  if (picks.some((n) => n < 1 || n > KENO_POOL)) {
    throw new Error(`Keno numbers must be 1..${KENO_POOL}`);
  }

  // 10 numbers drawn one at a time from those remaining (1..40).
  const fs = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, KENO_DRAW);
  const pool = Array.from({ length: KENO_POOL }, (_, i) => i + 1);
  const drawn = pickSequential(pool, KENO_DRAW, fs);
  const drawnSet = new Set(drawn);

  const hits = picks.filter((n) => drawnSet.has(n)).length;
  const multiplier = KENO_PAYTABLE[picks.length]?.[hits] ?? 0;

  return {
    game: "keno",
    outcome: { picks, drawn: drawn.sort((a, b) => a - b), hits },
    win: multiplier >= 1,
    multiplier,
    houseEdge: 0, // edge lives in the paytable; tune before real-money use
  };
}
