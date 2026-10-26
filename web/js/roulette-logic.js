// =============================================================================
// Browser Roulette logic — mirrors src/games/roulette.ts for DEMO mode and for
// showing odds in the UI. European single-zero wheel; one float picks the pocket.
// =============================================================================
import { floats } from "./fairness.js";

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** Pocket order around a real European wheel, clockwise from 0. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const ROULETTE_MAX_CHIPS = 50;

export function pocketColor(pocket) {
  if (pocket === 0) return "green";
  return RED.has(pocket) ? "red" : "black";
}

/** Total returned per unit staked when the bet wins (stake included). */
export function roulettePayoutMultiplier(bet) {
  switch (bet.type) {
    case "straight": return 36;
    case "dozen":
    case "column": return 3;
    default: return 2;
  }
}

export function rouletteBetWins(bet, pocket) {
  const color = pocketColor(pocket);
  switch (bet.type) {
    case "straight": return pocket === bet.number;
    case "red": return color === "red";
    case "black": return color === "black";
    case "odd": return pocket !== 0 && pocket % 2 === 1;
    case "even": return pocket !== 0 && pocket % 2 === 0;
    case "low": return pocket >= 1 && pocket <= 18;
    case "high": return pocket >= 19 && pocket <= 36;
    case "dozen": return pocket >= 1 && pocket <= 36 && Math.ceil(pocket / 12) === bet.dozen;
    case "column": return pocket !== 0 && pocket % 3 === bet.column % 3;
    default: return false;
  }
}

/** Human label for a bet spot. */
export function rouletteBetLabel(bet) {
  switch (bet.type) {
    case "straight": return `#${bet.number}`;
    case "dozen": return ["1st 12", "2nd 12", "3rd 12"][bet.dozen - 1];
    case "column": return `col ${bet.column}`;
    case "low": return "1-18";
    case "high": return "19-36";
    default: return bet.type;
  }
}

/**
 * Settle a set of chips against a pocket. `chips` = [{ bet, amount }].
 * Returns the total returned (stake included for winning chips).
 */
export function rouletteSettle(chips, pocket) {
  let returned = 0;
  for (const { bet, amount } of chips) {
    if (rouletteBetWins(bet, pocket)) returned += amount * roulettePayoutMultiplier(bet);
  }
  return returned;
}

/** Spin from the provably-fair seeds (same float → same pocket as the server). */
export async function roulettePocket(ctx) {
  const [u] = await floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  return Math.floor(u * 37);
}
