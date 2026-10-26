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

const twFloor2 = (x) => Math.floor(x * 100) / 100;

export function towerMultiplier(difficulty, rows, edge = HOUSE_EDGE) {
  if (rows <= 0) return 1;
  const safe = TOWER_COLS - TOWER_TRAPS[difficulty];
  const survival = Math.pow(safe / TOWER_COLS, rows);
  return twFloor2((1 / survival) * (1 - edge));
}

export function towerMaxMultiplier(difficulty) {
  return towerMultiplier(difficulty, TOWER_ROWS);
}

function shuffle(n, fs) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const f = fs[n - 1 - i] ?? 0;
    const j = Math.floor(f * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Full trap map: trap tile indices per row. Async (browser floats). */
export async function towerLayout(ctx, difficulty) {
  const traps = TOWER_TRAPS[difficulty];
  const perRow = TOWER_COLS - 1;
  const all = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, TOWER_ROWS * perRow);
  const rows = [];
  for (let r = 0; r < TOWER_ROWS; r++) {
    const slice = all.slice(r * perRow, r * perRow + perRow);
    const order = shuffle(TOWER_COLS, slice);
    rows.push(order.slice(0, traps).sort((a, b) => a - b));
  }
  return rows;
}
