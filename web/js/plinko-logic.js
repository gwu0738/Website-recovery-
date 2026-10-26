// =============================================================================
// Browser Plinko logic — mirrors src/games/plinko.ts (same generated paytables,
// same path rule) for DEMO mode and for drawing the bucket multipliers.
// =============================================================================
import { floats } from "./fairness.js";
import { HOUSE_EDGE } from "./config.js";

export const PLINKO_MIN_ROWS = 8;
export const PLINKO_MAX_ROWS = 16;
const SHAPE = {
  low: { centre: 0.5, edge8: 5.6, edge16: 16 },
  medium: { centre: 0.4, edge8: 13, edge16: 110 },
  high: { centre: 0.2, edge8: 29, edge16: 1000 },
};
const floor2Safe = (x) => Math.floor(Math.round(x * 1e8) / 1e6) / 100;
function tidyFloor(v) {
  if (v >= 100) return Math.floor(v);
  if (v >= 10) return Math.floor(Math.round(v * 1e7) / 1e6) / 10;
  return floor2Safe(v);
}
function binomialProbs(rows) {
  let p = [1];
  for (let r = 0; r < rows; r++) {
    const next = Array(p.length + 1).fill(0);
    p.forEach((v, k) => { next[k] += v / 2; next[k + 1] += v / 2; });
    p = next;
  }
  return p;
}
export function plinkoRtp(table, rows) {
  const p = binomialProbs(rows);
  return table.reduce((acc, m, k) => acc + p[k] * m, 0);
}
const cache = new Map();
export function plinkoTable(rows, risk, houseEdge = HOUSE_EDGE) {
  const k = `${rows}:${risk}:${houseEdge}`;
  if (cache.has(k)) return cache.get(k);
  const { centre, edge8, edge16 } = SHAPE[risk];
  const edge = edge8 * Math.pow(edge16 / edge8, (rows - 8) / 8);
  const xs = Array.from({ length: rows + 1 }, (_, i) => Math.abs(2 * i - rows) / rows);
  const table = (g) => xs.map((x) => tidyFloor(centre * Math.pow(edge / centre, Math.pow(x, g))));
  const target = 1 - houseEdge;
  let lo = Math.log(0.05);
  let hi = Math.log(50);
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (plinkoRtp(table(Math.exp(mid)), rows) > target) lo = mid;
    else hi = mid;
  }
  const out = table(Math.exp(hi));
  cache.set(k, out);
  return out;
}

/** One float per row: 0 = left, 1 = right. Bucket = number of rights. Async. */
export async function plinkoDrop(ctx, rows) {
  const fs = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, rows);
  const path = fs.map((f) => (Math.floor(f * 2) === 0 ? "L" : "R"));
  return { path, bucket: path.filter((d) => d === "R").length };
}
