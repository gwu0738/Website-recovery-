/**
 * Tower — climb a tower row by row. Each row has `cols` tiles, of which `safe`
 * are safe and the rest are traps. Pick one tile per row: a safe tile climbs you
 * up and raises the multiplier; a trap ends the run.
 *
 * Trap positions for every row are fixed before you click, by a provably-fair
 * shuffle of each row's tiles. Multiplier after climbing n rows is
 * (1 - houseEdge) / P(n rows), where each row's survival chance is safe/cols.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2, shuffleIndices } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export type TowerDifficulty = "easy" | "medium" | "hard";

/** cols = tiles per row, safe = safe tiles per row. */
export const TOWER_DIFFICULTY: Record<TowerDifficulty, { cols: number; safe: number }> = {
  easy: { cols: 4, safe: 3 },
  medium: { cols: 3, safe: 2 },
  hard: { cols: 2, safe: 1 },
};

export const TOWER_ROWS = 9;

export interface TowerBet {
  difficulty: TowerDifficulty;
  /** Chosen tile index (0..cols-1) for each row the player attempts, in order. */
  picks: number[];
}

export interface TowerOutcome {
  difficulty: TowerDifficulty;
  trapsPerRow: number[][]; // trap tile indices for each attempted row
  picks: number[];
  rowsClimbed: number;
  bust: boolean;
}

/** Multiplier after climbing `rows` rows at a given difficulty. */
export function towerMultiplier(
  difficulty: TowerDifficulty,
  rows: number,
  houseEdge = HOUSE_EDGE,
): number {
  if (rows <= 0) return 1;
  const { cols, safe } = TOWER_DIFFICULTY[difficulty];
  const survival = Math.pow(safe / cols, rows); // P(climb `rows` rows)
  return floor2((1 / survival) * (1 - houseEdge));
}

export function playTower(
  ctx: BetContext,
  bet: TowerBet,
  houseEdge = HOUSE_EDGE,
): GameResult<TowerOutcome> {
  const cfg = TOWER_DIFFICULTY[bet.difficulty];
  if (!cfg) throw new Error("Unknown tower difficulty");
  if (bet.picks.length === 0 || bet.picks.length > TOWER_ROWS) {
    throw new Error(`Tower picks must be 1..${TOWER_ROWS}`);
  }
  // Each row needs cols-1 floats to shuffle its tiles.
  const perRow = cfg.cols - 1;
  const all = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, TOWER_ROWS * perRow);

  const trapsPerRow: number[][] = [];
  let rowsClimbed = 0;
  let bust = false;

  for (let row = 0; row < bet.picks.length; row++) {
    const slice = all.slice(row * perRow, row * perRow + perRow);
    const order = shuffleIndices(cfg.cols, slice);
    const traps = order.slice(0, cfg.cols - cfg.safe).sort((a, b) => a - b);
    trapsPerRow.push(traps);
    if (traps.includes(bet.picks[row])) {
      bust = true;
      break;
    }
    rowsClimbed++;
  }

  const multiplier = bust ? 0 : towerMultiplier(bet.difficulty, rowsClimbed, houseEdge);
  return {
    game: "tower",
    outcome: { difficulty: bet.difficulty, trapsPerRow, picks: bet.picks, rowsClimbed, bust },
    win: !bust && rowsClimbed > 0,
    multiplier,
    houseEdge,
  };
}
