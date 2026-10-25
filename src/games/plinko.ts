/**
 * Plinko — a ball drops through `rows` pegs, bouncing left or right at each one,
 * and lands in one of (rows + 1) buckets, each with its own multiplier.
 *
 * Each row uses one float: < 0.5 goes left, >= 0.5 goes right. The number of
 * rights is the landing bucket index (a binomial distribution — middle buckets
 * are far more likely, which is why the edge buckets pay the most).
 *
 * The payout tables below are tuned so the overall expected return is roughly
 * (1 - houseEdge). Swap these numbers to re-skin the game; the fairness engine
 * is untouched.
 */
import { floats } from "../fairness/engine.ts";
import type { BetContext, GameResult } from "./types.ts";

export type PlinkoRisk = "low" | "medium" | "high";

/** Multiplier tables indexed by risk, then by row count, bucket order L->R. */
export const PLINKO_TABLES: Record<PlinkoRisk, Record<number, number[]>> = {
  low: {
    8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    12: [8.4, 3, 1.6, 1.1, 1, 0.5, 0.5, 0.5, 1, 1.1, 1.6, 3, 8.4],
    16: [16, 9, 2, 1.4, 1.1, 1, 0.5, 0.5, 0.3, 0.5, 0.5, 1, 1.1, 1.4, 2, 9, 16],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    12: [24, 5, 2, 1.4, 0.6, 0.4, 0.3, 0.4, 0.6, 1.4, 2, 5, 24],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    12: [58, 8, 3, 2, 0.5, 0.2, 0.2, 0.2, 0.5, 2, 3, 8, 58],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

export interface PlinkoBet {
  rows: 8 | 12 | 16;
  risk: PlinkoRisk;
}

export interface PlinkoOutcome {
  path: ("L" | "R")[];
  bucket: number;
  rows: number;
  risk: PlinkoRisk;
}

export function playPlinko(
  ctx: BetContext,
  bet: PlinkoBet,
): GameResult<PlinkoOutcome> {
  const table = PLINKO_TABLES[bet.risk]?.[bet.rows];
  if (!table) throw new Error(`No Plinko table for ${bet.risk}/${bet.rows} rows`);

  const fs = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, bet.rows);
  const path = fs.map((f) => (f < 0.5 ? "L" : "R")) as ("L" | "R")[];
  const bucket = path.filter((d) => d === "R").length;
  const multiplier = table[bucket];

  return {
    game: "plinko",
    outcome: { path, bucket, rows: bet.rows, risk: bet.risk },
    // Plinko always "pays" its bucket; win just means multiplier >= 1.
    win: multiplier >= 1,
    multiplier,
    houseEdge: 0, // edge is baked into the payout table, not applied separately
  };
}
