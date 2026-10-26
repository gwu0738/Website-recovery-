// =============================================================================
// Browser Tower logic — mirrors src/games/tower.ts for DEMO mode (no backend).
// 4 columns per row; difficulty sets trap count. Uses the browser fairness
// engine (async floats).
// =============================================================================
import { floats } from "./fairness.js";
import { HOUSE_EDGE } from "./config.js";

export const TOWER_COLS = 4;
export const TOWER_ROWS = 9;
export const TOWER_TRAPS = { easy: 1, medium: 2, hard: 3 };

// floor to 2dp after rounding away float noise (same as shared.ts floor2Safe)
const twFloor2 = (x) => Math.floor(Math.round(x * 1e8) / 1e6) / 100;

export function towerMultiplier(difficulty, rows, edge = HOUSE_EDGE) {
  if (rows <= 0) return 1;
  const safe = TOWER_COLS - TOWER_TRAPS[difficulty];
  const survival = Math.pow(safe / TOWER_COLS, rows);
  return twFloor2((1 / survival) * (1 - edge));
}

export function towerMaxMultiplier(difficulty) {
  return towerMultiplier(difficulty, TOWER_ROWS);
}

// Pick `count` items one at a time from those remaining (same as shared.ts
// pickSequential): the i-th float chooses an index among what's left.
function pickSequential(pool, count, fs) {
  const remaining = [...pool];
  const picks = [];
  for (let i = 0; i < count; i++) {
    picks.push(remaining.splice(Math.floor(fs[i] * remaining.length), 1)[0]);
  }
  return picks;
}

/** Full trap map: per row, safe tiles placed one at a time; the rest are traps. Async. */
export async function towerLayout(ctx, difficulty) {
  const safePerRow = TOWER_COLS - TOWER_TRAPS[difficulty];
  const all = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, TOWER_ROWS * safePerRow);
  const columns = Array.from({ length: TOWER_COLS }, (_, i) => i);
  const rows = [];
  for (let r = 0; r < TOWER_ROWS; r++) {
    const safe = new Set(pickSequential(columns, safePerRow, all.slice(r * safePerRow, (r + 1) * safePerRow)));
    rows.push(columns.filter((c) => !safe.has(c)));
  }
  return rows;
}
