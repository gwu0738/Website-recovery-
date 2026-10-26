/**
 * Plinko — a ball drops through `rows` pegs (8..16), bouncing left or right at
 * each, and lands in one of (rows + 1) buckets.
 *
 * Path: one float per row, floor(f * 2) -> 0 = left, 1 = right. The bucket is
 * the number of rights, so bucket k has binomial probability C(rows, k) / 2^rows.
 *
 * Payout tables are our own, generated (not hand-copied) for every rows × risk:
 * each risk fixes a centre multiplier and an edge multiplier (edges grow with
 * rows), and the curve between them, value = centre * (edge/centre)^(x^gamma)
 * with x = distance from centre in [0, 1], has its gamma solved so the
 * expected return is exactly (1 - houseEdge). Values are then floored to tidy
 * figures, which only ever lowers the return. Tests check every table.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2Safe } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export type PlinkoRisk = "low" | "medium" | "high";
export const PLINKO_MIN_ROWS = 8;
export const PLINKO_MAX_ROWS = 16;

/** Centre multiplier, and edge multiplier at 8 and at 16 rows, per risk. */
const PLINKO_SHAPE: Record<PlinkoRisk, { centre: number; edge8: number; edge16: number }> = {
  low: { centre: 0.5, edge8: 5.6, edge16: 16 },
  medium: { centre: 0.4, edge8: 13, edge16: 110 },
  high: { centre: 0.2, edge8: 29, edge16: 1000 },
};

function binomialProbs(rows: number): number[] {
  const p = [1];
  for (let r = 0; r < rows; r++) {
    const next = Array(p.length + 1).fill(0);
    p.forEach((v, k) => {
      next[k] += v / 2;
      next[k + 1] += v / 2;
    });
    p.splice(0, p.length, ...next);
  }
  return p;
}

/** Floor to a tidy number of decimals for display (never rounds up). */
function tidyFloor(v: number): number {
  if (v >= 100) return Math.floor(v);
  if (v >= 10) return Math.floor(Math.round(v * 1e7) / 1e6) / 10;
  return floor2Safe(v);
}

export function plinkoRtp(table: readonly number[], rows: number): number {
  const p = binomialProbs(rows);
  return table.reduce((acc, m, k) => acc + p[k] * m, 0);
}

function buildTable(rows: number, risk: PlinkoRisk, houseEdge: number): number[] {
  const { centre, edge8, edge16 } = PLINKO_SHAPE[risk];
  const edge = edge8 * Math.pow(edge16 / edge8, (rows - 8) / 8);
  const xs = Array.from({ length: rows + 1 }, (_, k) => Math.abs(2 * k - rows) / rows);
  const curve = (gamma: number) => xs.map((x) => centre * Math.pow(edge / centre, Math.pow(x, gamma)));

  // RTP falls as gamma rises. Bisect (in log space) on the *floored* table, so
  // the final return sits just at or below 1 - houseEdge (never above).
  const target = 1 - houseEdge;
  const table = (g: number) => curve(g).map(tidyFloor);
  let lo = Math.log(0.05);
  let hi = Math.log(50);
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (plinkoRtp(table(Math.exp(mid)), rows) > target) lo = mid;
    else hi = mid;
  }
  return table(Math.exp(hi));
}

const tables = new Map<string, number[]>();

/** Payout table (bucket 0..rows) for a rows/risk combination. */
export function plinkoTable(rows: number, risk: PlinkoRisk, houseEdge = HOUSE_EDGE): number[] {
  if (!Number.isInteger(rows) || rows < PLINKO_MIN_ROWS || rows > PLINKO_MAX_ROWS) {
    throw new Error(`Plinko rows must be ${PLINKO_MIN_ROWS}..${PLINKO_MAX_ROWS}`);
  }
  if (!PLINKO_SHAPE[risk]) throw new Error(`Unknown plinko risk: ${risk}`);
  const key = `${rows}:${risk}:${houseEdge}`;
  if (!tables.has(key)) tables.set(key, buildTable(rows, risk, houseEdge));
  return tables.get(key)!;
}

export interface PlinkoBet {
  rows: number; // 8..16
  risk: PlinkoRisk;
}

export interface PlinkoOutcome {
  path: ("L" | "R")[];
  bucket: number;
  rows: number;
  risk: PlinkoRisk;
}

export function playPlinko(ctx: BetContext, bet: PlinkoBet): GameResult<PlinkoOutcome> {
  const table = plinkoTable(bet.rows, bet.risk);
  const fs = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, bet.rows);
  const path = fs.map((f) => (Math.floor(f * 2) === 0 ? "L" : "R")) as ("L" | "R")[];
  const bucket = path.filter((d) => d === "R").length;
  const multiplier = table[bucket];

  return {
    game: "plinko",
    outcome: { path, bucket, rows: bet.rows, risk: bet.risk },
    win: multiplier >= 1,
    multiplier,
    houseEdge: 1 - plinkoRtp(table, bet.rows),
  };
}
