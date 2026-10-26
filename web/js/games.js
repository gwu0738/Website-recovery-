// =============================================================================
// Browser game logic — mirrors src/games/* using the browser fairness engine,
// for DEMO mode (no backend). Every play function returns the same shape the
// server returns for a bet: { game, outcome, win, multiplier }, so the UIs and
// the result log don't care which mode they're in.
// =============================================================================
import { floats } from "./fairness.js";
import { HOUSE_EDGE } from "./config.js";
import { ICONS } from "./icons.js";
import { plinkoTable } from "./plinko-logic.js";

const floor2 = (x) => Math.floor(x * 100) / 100;
const floor2Safe = (x) => Math.floor(Math.round(x * 1e8) / 1e6) / 100;
export const payoutFor = (p, edge = HOUSE_EDGE) => (p <= 0 ? 0 : floor2((1 / p) * (1 - edge)));

// Pick `count` items one at a time from a pool (same as shared.ts pickSequential).
export function pickSequential(pool, count, fs) {
  const remaining = [...pool];
  const picks = [];
  for (let i = 0; i < count; i++) picks.push(remaining.splice(Math.floor(fs[i] * remaining.length), 1)[0]);
  return picks;
}

// ---- Dice -------------------------------------------------------------------
export async function playDice(ctx, { target, direction }, edge = HOUSE_EDGE) {
  const [f] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const roll = Math.floor(f * 10001) / 100;
  const win = direction === "under" ? roll < target : roll > target;
  const chance = direction === "under" ? target / 100 : (100 - target) / 100;
  return { game: "dice", outcome: { roll, target, direction }, win, multiplier: win ? payoutFor(chance, edge) : 0 };
}

// ---- Limbo / Crash (shared result formula, 10^8 space) -----------------------
export function resultMultiplier(u, edge = HOUSE_EDGE) {
  const n = Math.floor(u * 1e8) + 1;
  return floor2Safe(Math.max((1e8 / n) * (1 - edge), 1));
}
export async function playLimbo(ctx, { target }, edge = HOUSE_EDGE) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const result = resultMultiplier(u, edge);
  const win = result >= target;
  return { game: "limbo", outcome: { result, target }, win, multiplier: win ? target : 0 };
}
export async function playCrash(ctx, { cashOut }, edge = HOUSE_EDGE) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const bustAt = resultMultiplier(u, edge);
  const win = bustAt >= cashOut;
  return { game: "crash", outcome: { bustAt, cashOut }, win, multiplier: win ? cashOut : 0 };
}

// ---- Coinflip ---------------------------------------------------------------
export async function playCoinflip(ctx, { call }, edge = HOUSE_EDGE) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const flip = u < 0.5 ? "heads" : "tails";
  const win = flip === call;
  return { game: "coinflip", outcome: { flip, call }, win, multiplier: win ? payoutFor(0.5, edge) : 0 };
}

// ---- Wheel ------------------------------------------------------------------
export const WHEEL_SEGMENTS = {
  low: [1.5, 1.2, 1.5, 0, 1.5, 1.2, 1.5, 0, 1.5, 1.2, 1.5, 0],
  medium: [0, 1.9, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.9],
  high: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48],
};
export async function playWheel(ctx, { risk }) {
  const segments = WHEEL_SEGMENTS[risk];
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const segment = Math.floor(u * segments.length);
  const multiplier = segments[segment];
  return { game: "wheel", outcome: { segment, multiplier, risk }, win: multiplier >= 1, multiplier };
}

// ---- Plinko -----------------------------------------------------------------
export async function playPlinko(ctx, { rows, risk }) {
  const table = plinkoTable(rows, risk);
  const fs = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, rows);
  const path = fs.map((f) => (Math.floor(f * 2) === 0 ? "L" : "R"));
  const bucket = path.filter((d) => d === "R").length;
  const multiplier = table[bucket];
  return { game: "plinko", outcome: { path, bucket, rows, risk }, win: multiplier >= 1, multiplier };
}

// ---- HiLo (ranks 0..12, 0 = 2 … 12 = Ace) ------------------------------------
export const HILO_RANKS = 13;
export const hiloChance = (base, guess) =>
  guess === "higherOrSame" ? (HILO_RANKS - base) / HILO_RANKS : (base + 1) / HILO_RANKS;
export async function playHiLo(ctx, { guess }, edge = HOUSE_EDGE) {
  const [f0, f1] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 2);
  const base = Math.floor(f0 * HILO_RANKS);
  const next = Math.floor(f1 * HILO_RANKS);
  const win = guess === "higherOrSame" ? next >= base : next <= base;
  const multiplier = win ? floor2((1 / hiloChance(base, guess)) * (1 - edge)) : 0;
  return { game: "hilo", outcome: { base, next, guess }, win, multiplier };
}
/** The base card is drawn from the SAME floats as the bet, so the UI can show it first. */
export async function hiloBaseCard(ctx) {
  const [f0] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  return Math.floor(f0 * HILO_RANKS);
}

// ---- Darts ------------------------------------------------------------------
export const DARTS_MULTIPLIERS = [0.5, 0.8, 1.2, 1.5, 2.7, 8.5];
export const DARTS_WEIGHTS = {
  easy: [0.38, 0.3, 0.18, 0.08, 0.05, 0.01],
  medium: [0.45, 0.26, 0.15, 0.08, 0.05, 0.01],
  hard: [0.52, 0.22, 0.13, 0.07, 0.05, 0.01],
  expert: [0.58, 0.19, 0.11, 0.06, 0.05, 0.01],
};
function weightedIndex(u, weights) {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (u < acc) return i;
  }
  return weights.length - 1;
}
export async function playDarts(ctx, { difficulty }) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const band = weightedIndex(u, DARTS_WEIGHTS[difficulty]);
  const multiplier = DARTS_MULTIPLIERS[band];
  return { game: "darts", outcome: { difficulty, band, multiplier }, win: multiplier >= 1, multiplier };
}

// ---- Snakes -----------------------------------------------------------------
export const SNAKES_OUTCOMES = [
  { multiplier: 0, weight: 0.275 },
  { multiplier: 1.11, weight: 0.48 },
  { multiplier: 1.4, weight: 0.18 },
  { multiplier: 2.5, weight: 0.05 },
  { multiplier: 4.0, weight: 0.015 },
];
export async function playSnakes(ctx) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const index = weightedIndex(u, SNAKES_OUTCOMES.map((o) => o.weight));
  const multiplier = SNAKES_OUTCOMES[index].multiplier;
  return { game: "snakes", outcome: { index, multiplier }, win: multiplier >= 1, multiplier };
}

// ---- Keno -------------------------------------------------------------------
export const KENO_POOL = 40;
export const KENO_DRAW = 10;
export const KENO_MAX_PICKS = 10;
export const KENO_PAYTABLE = {
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
export async function playKeno(ctx, { picks }) {
  const fs = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, KENO_DRAW);
  const pool = Array.from({ length: KENO_POOL }, (_, i) => i + 1);
  const drawn = pickSequential(pool, KENO_DRAW, fs); // draw order kept for the animation
  const hits = picks.filter((n) => drawn.includes(n)).length;
  const multiplier = KENO_PAYTABLE[picks.length]?.[hits] ?? 0;
  return { game: "keno", outcome: { picks, drawn, hits }, win: multiplier >= 1, multiplier };
}

// ---- Mines (demo layout; the real game runs as a server session) ------------
export const MINES_GRID = 25;
export function minesMultiplier(mines, k, edge = HOUSE_EDGE) {
  if (k <= 0) return 1;
  const safe = MINES_GRID - mines;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (safe - i) / (MINES_GRID - i);
  return floor2Safe((1 / p) * (1 - edge));
}
export async function minesLayout(ctx, mines) {
  const fs = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, mines);
  const tiles = Array.from({ length: MINES_GRID }, (_, i) => i);
  return pickSequential(tiles, mines, fs).sort((a, b) => a - b);
}

// Catalogue used to render the games grid.
export const GAME_CATALOG = [
  { id: "dice", name: "Dice", blurb: "Roll under or over your target.", playable: true, icon: ICONS.dice },
  { id: "mines", name: "Mines", blurb: "Reveal gems, dodge the bombs.", playable: true, icon: ICONS.mines },
  { id: "plinko", name: "Plinko", blurb: "Drop a ball through the pegs.", playable: true, icon: ICONS.plinko },
  { id: "limbo", name: "Limbo", blurb: "Beat the multiplier.", playable: true, icon: ICONS.limbo },
  { id: "crash", name: "Crash", blurb: "Cash out before the bust.", playable: true, icon: ICONS.crash },
  { id: "roulette", name: "Roulette", blurb: "Real wheel, real table, single zero.", playable: true, icon: ICONS.roulette },
  { id: "tower", name: "Tower", blurb: "Climb, dodge the traps.", playable: true, icon: ICONS.tower },
  { id: "hilo", name: "HiLo", blurb: "Higher or lower than the card?", playable: true, icon: ICONS.hilo },
  { id: "keno", name: "Keno", blurb: "Pick numbers, watch the draw.", playable: true, icon: ICONS.keno },
  { id: "chicken", name: "Chicken", blurb: "Cross the road, cash out.", playable: true, icon: ICONS.chicken },
  { id: "darts", name: "Darts", blurb: "Throw for the bullseye.", playable: true, icon: ICONS.darts },
  { id: "snakes", name: "Snakes", blurb: "Climb the board, mind the snakes.", playable: true, icon: ICONS.snakes },
  { id: "wheel", name: "Wheel", blurb: "Spin for a multiplier.", playable: true, icon: ICONS.wheel },
  { id: "coinflip", name: "Coinflip", blurb: "Heads or tails, ~2x.", playable: true, icon: ICONS.coinflip },
];
