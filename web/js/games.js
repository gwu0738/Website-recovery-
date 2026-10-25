// =============================================================================
// Browser game logic — mirrors src/games/* using the browser fairness engine.
// Playable in-browser: Dice, Limbo, Coinflip, Wheel. (Crash/Mines/Plinko/
// Roulette share the same math and are wired on the server engine too.)
// =============================================================================
import { floats } from "./fairness.js";
import { HOUSE_EDGE } from "./config.js";
import { ICONS } from "./icons.js";

const floor2 = (x) => Math.floor(x * 100) / 100;
const payoutFor = (p, edge) => (p <= 0 ? 0 : floor2((1 / p) * (1 - edge)));

export async function playDice(ctx, { target, direction }, edge = HOUSE_EDGE) {
  const [f] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const roll = Math.floor(f * 10001) / 100;
  const win = direction === "under" ? roll < target : roll > target;
  const chance = direction === "under" ? target / 100 : (100 - target) / 100;
  return { game: "dice", roll, win, multiplier: win ? payoutFor(chance, edge) : 0 };
}

export async function playLimbo(ctx, { target }, edge = HOUSE_EDGE) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const result = u >= 1 ? 1e6 : Math.max(1, floor2((1 - edge) / (1 - u)));
  const win = result >= target;
  return { game: "limbo", result, win, multiplier: win ? target : 0 };
}

export async function playCoinflip(ctx, { call }, edge = HOUSE_EDGE) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const flip = u < 0.5 ? "heads" : "tails";
  const win = flip === call;
  return { game: "coinflip", flip, win, multiplier: win ? payoutFor(0.5, edge) : 0 };
}

const WHEEL = [0, 1.9, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.9];
export async function playWheel(ctx) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const segment = Math.floor(u * WHEEL.length);
  const multiplier = WHEEL[segment];
  return { game: "wheel", segment, multiplier, win: multiplier >= 1 };
}

// Catalogue used to render the games grid. Playable ones have a `play` fn.
export const GAME_CATALOG = [
  { id: "dice", name: "Dice", blurb: "Roll under or over your target.", playable: true, icon: ICONS.dice },
  { id: "limbo", name: "Limbo", blurb: "Beat the multiplier.", playable: true, icon: ICONS.limbo },
  { id: "coinflip", name: "Coinflip", blurb: "Heads or tails, ~2x.", playable: true, icon: ICONS.coinflip },
  { id: "wheel", name: "Wheel", blurb: "Spin for a multiplier.", playable: true, icon: ICONS.wheel },
  { id: "crash", name: "Crash", blurb: "Cash out before the bust.", playable: false, icon: ICONS.crash },
  { id: "mines", name: "Mines", blurb: "Dodge the hidden bombs.", playable: false, icon: ICONS.mines },
  { id: "plinko", name: "Plinko", blurb: "Drop into a payout bucket.", playable: false, icon: ICONS.plinko },
  { id: "roulette", name: "Roulette", blurb: "European single-zero wheel.", playable: false, icon: ICONS.roulette },
];
