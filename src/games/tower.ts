/**
 * Tower — climb a tower of rows, each with 4 tiles. Some tiles are traps (the
 * count depends on difficulty); the rest are safe. Pick one tile per row: a safe
 * tile climbs you up and raises the multiplier, a trap ends the run.
 *
 *   Easy   = 1 trap  / 4 (3 safe)   survival 3/4 per row
 *   Medium = 2 traps / 4 (2 safe)   survival 1/2 per row
 *   Hard   = 3 traps / 4 (1 safe)   survival 1/4 per row
 *
 * Trap positions for every row are fixed before play by a provably-fair shuffle
 * of each row's 4 tiles (`towerLayout`). Multiplier after climbing n rows is
 * (1 - houseEdge) / survival^n, so the edge is exact.
 *
 * `towerLayout` gives the full trap map (used by the interactive game session
 * and by verification); `playTower` is the single-shot resolution used by the
 * verifier and tests.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2Safe, pickSequential } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export type TowerDifficulty = "easy" | "medium" | "hard";

export const TOWER_COLS = 4;
export const TOWER_ROWS = 9;

/** Traps per row by difficulty (out of TOWER_COLS tiles). */
export const TOWER_TRAPS: Record<TowerDifficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

/** Multiplier after climbing `rows` rows at a given difficulty. */
export function towerMultiplier(
  difficulty: TowerDifficulty,
  rows: number,
  houseEdge = HOUSE_EDGE,
): number {
  if (rows <= 0) return 1;
  const safe = TOWER_COLS - TOWER_TRAPS[difficulty];
  const survival = Math.pow(safe / TOWER_COLS, rows);
  return floor2Safe((1 / survival) * (1 - houseEdge));
}

/** The theoretical max multiplier (reaching the top). */
export function towerMaxMultiplier(difficulty: TowerDifficulty, houseEdge = HOUSE_EDGE): number {
  return towerMultiplier(difficulty, TOWER_ROWS, houseEdge);
}

/**
 * Full trap map: the trap tile indices for each of TOWER_ROWS rows.
 * Per row, the safe tiles are placed one at a time from the columns still free
 * (each consuming the next float); the remaining columns are traps.
 */
export function towerLayout(ctx: BetContext, difficulty: TowerDifficulty): number[][] {
  const traps = TOWER_TRAPS[difficulty];
  if (traps === undefined) throw new Error("Unknown tower difficulty");
  const safePerRow = TOWER_COLS - traps;
  const all = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, TOWER_ROWS * safePerRow);
  const columns = Array.from({ length: TOWER_COLS }, (_, i) => i);
  const rows: number[][] = [];
  for (let r = 0; r < TOWER_ROWS; r++) {
    const fs = all.slice(r * safePerRow, (r + 1) * safePerRow);
    const safe = new Set(pickSequential(columns, safePerRow, fs));
    rows.push(columns.filter((c) => !safe.has(c)));
  }
  return rows;
}

export interface TowerBet {
  difficulty: TowerDifficulty;
  /** Chosen tile index (0..3) for each row the player attempts, in order. */
  picks: number[];
}

export interface TowerOutcome {
  difficulty: TowerDifficulty;
  trapsPerRow: number[][]; // full layout (all rows)
  picks: number[];
  rowsClimbed: number;
  bust: boolean;
}

export function playTower(
  ctx: BetContext,
  bet: TowerBet,
  houseEdge = HOUSE_EDGE,
): GameResult<TowerOutcome> {
  if (bet.picks.length === 0 || bet.picks.length > TOWER_ROWS) {
    throw new Error(`Tower picks must be 1..${TOWER_ROWS}`);
  }
  if (bet.picks.some((p) => p < 0 || p >= TOWER_COLS)) {
    throw new Error(`Tower picks must be 0..${TOWER_COLS - 1}`);
  }
  const trapsPerRow = towerLayout(ctx, bet.difficulty);

  let rowsClimbed = 0;
  let bust = false;
  for (let row = 0; row < bet.picks.length; row++) {
    if (trapsPerRow[row].includes(bet.picks[row])) {
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
