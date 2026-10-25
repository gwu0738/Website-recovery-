/**
 * Mines — a 5x5 grid (25 tiles) with N hidden mines. The player reveals tiles;
 * each safe reveal raises the multiplier. Hitting a mine loses everything.
 *
 * The mine layout is a provably-fair shuffle of the 25 tiles: the first N tiles
 * of the shuffled order are the mines. Because the shuffle is deterministic from
 * the bet context, the layout is fixed before the player clicks anything.
 *
 * Multiplier after k safe reveals = (1 - houseEdge) / P(k safe picks), where
 * P = product over the k picks of (safe remaining / tiles remaining).
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2, shuffleIndices } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export const GRID_SIZE = 25;

export interface MinesBet {
  /** Number of mines on the grid (1 .. 24). */
  mines: number;
  /** Tile indices (0..24) the player chooses to reveal, in order. */
  picks: number[];
}

export interface MinesOutcome {
  minePositions: number[];
  picks: number[];
  /** How many safe tiles the player revealed before stopping or busting. */
  safeReveals: number;
  bust: boolean;
}

/** Fair multiplier after revealing `k` safe tiles with `mines` mines present. */
export function minesMultiplier(
  mines: number,
  k: number,
  houseEdge = HOUSE_EDGE,
): number {
  if (k <= 0) return 1;
  const safe = GRID_SIZE - mines;
  let p = 1;
  for (let i = 0; i < k; i++) {
    p *= (safe - i) / (GRID_SIZE - i);
  }
  return floor2((1 / p) * (1 - houseEdge));
}

export function playMines(
  ctx: BetContext,
  bet: MinesBet,
  houseEdge = HOUSE_EDGE,
): GameResult<MinesOutcome> {
  if (bet.mines < 1 || bet.mines > 24) {
    throw new Error("Mines count must be between 1 and 24");
  }
  // 24 floats are enough to fully shuffle 25 tiles.
  const fs = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, GRID_SIZE - 1);
  const order = shuffleIndices(GRID_SIZE, fs);
  const minePositions = order.slice(0, bet.mines).sort((a, b) => a - b);
  const mineSet = new Set(minePositions);

  let safeReveals = 0;
  let bust = false;
  for (const pick of bet.picks) {
    if (mineSet.has(pick)) {
      bust = true;
      break;
    }
    safeReveals++;
  }

  const multiplier = bust ? 0 : minesMultiplier(bet.mines, safeReveals, houseEdge);
  return {
    game: "mines",
    outcome: { minePositions, picks: bet.picks, safeReveals, bust },
    win: !bust && safeReveals > 0,
    multiplier,
    houseEdge,
  };
}
