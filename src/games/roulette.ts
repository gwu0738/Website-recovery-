/**
 * Roulette — European single-zero wheel (pockets 0..36). One float selects the
 * pocket. A resolver handles the common bet types and their standard payouts,
 * and a "multi" bet settles several chips on the same spin (a real table).
 *
 * The single green 0 is the house edge: on a 37-pocket wheel paying "fair" odds
 * as if there were 36, the expected return works out to ~2.70% edge, the real
 * European-roulette number. No separate edge factor is applied here.
 */
import { floats } from "../fairness/engine.ts";
import type { BetContext, GameResult } from "./types.ts";

const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** Pocket order around a European wheel, clockwise from 0 (for the UI). */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export type RouletteSingleBet =
  | { type: "straight"; number: number } // single number, pays 35:1
  | { type: "red" | "black" } // pays 1:1
  | { type: "odd" | "even" } // pays 1:1
  | { type: "low" | "high" } // 1-18 / 19-36, pays 1:1
  | { type: "dozen"; dozen: 1 | 2 | 3 } // pays 2:1
  | { type: "column"; column: 1 | 2 | 3 }; // pays 2:1

/**
 * Several chips on one spin. `weight` is each chip's share of the stake (any
 * positive integers, e.g. lamports); the result multiplier is total return /
 * total weight, so `stake × multiplier` is exactly the table's payout when the
 * weights are the lamports actually staked.
 */
export interface RouletteMultiBet {
  type: "multi";
  bets: { bet: RouletteSingleBet; weight: number }[];
}

export type RouletteBet = RouletteSingleBet | RouletteMultiBet;

/** Most chips a single spin accepts (every number plus every outside bet). */
export const ROULETTE_MAX_CHIPS = 50;

export interface RouletteOutcome {
  pocket: number;
  color: "red" | "black" | "green";
}

export function pocketColor(pocket: number): "red" | "black" | "green" {
  if (pocket === 0) return "green";
  return RED.has(pocket) ? "red" : "black";
}

/** Total returned per unit staked if the bet wins (stake included). */
export function roulettePayoutMultiplier(bet: RouletteSingleBet): number {
  switch (bet.type) {
    case "straight":
      return 36; // 35:1 win + original stake
    case "dozen":
    case "column":
      return 3; // 2:1 + stake
    default:
      return 2; // 1:1 + stake
  }
}

export function rouletteBetWins(bet: RouletteSingleBet, pocket: number): boolean {
  const color = pocketColor(pocket);
  switch (bet.type) {
    case "straight":
      return pocket === bet.number;
    case "red":
      return color === "red";
    case "black":
      return color === "black";
    case "odd":
      return pocket !== 0 && pocket % 2 === 1;
    case "even":
      return pocket !== 0 && pocket % 2 === 0;
    case "low":
      return pocket >= 1 && pocket <= 18;
    case "high":
      return pocket >= 19 && pocket <= 36;
    case "dozen":
      return pocket >= 1 && pocket <= 36 &&
        Math.ceil(pocket / 12) === bet.dozen;
    case "column":
      return pocket !== 0 && pocket % 3 === (bet.column % 3);
  }
}

const isInt = (x: unknown): x is number => Number.isInteger(x);

function validateSingle(bet: RouletteSingleBet): void {
  if (!bet || typeof bet !== "object") throw new Error("Invalid roulette bet");
  switch (bet.type) {
    case "straight":
      if (!isInt(bet.number) || bet.number < 0 || bet.number > 36) {
        throw new Error("Straight bet number must be 0-36");
      }
      return;
    case "dozen":
      if (!isInt(bet.dozen) || bet.dozen < 1 || bet.dozen > 3) throw new Error("Dozen must be 1-3");
      return;
    case "column":
      if (!isInt(bet.column) || bet.column < 1 || bet.column > 3) throw new Error("Column must be 1-3");
      return;
    case "red":
    case "black":
    case "odd":
    case "even":
    case "low":
    case "high":
      return;
    default:
      throw new Error("Unknown roulette bet type");
  }
}

/** Throws on malformed bets, so bad input is rejected before any money moves. */
export function validateRouletteBet(bet: RouletteBet): void {
  if (!bet || typeof bet !== "object") throw new Error("Invalid roulette bet");
  if (bet.type !== "multi") return validateSingle(bet);
  if (!Array.isArray(bet.bets) || bet.bets.length < 1 || bet.bets.length > ROULETTE_MAX_CHIPS) {
    throw new Error(`Place between 1 and ${ROULETTE_MAX_CHIPS} chips`);
  }
  for (const chip of bet.bets) {
    if (!chip || !isInt(chip.weight) || chip.weight <= 0) throw new Error("Each chip needs a positive whole amount");
    validateSingle(chip.bet);
  }
}

/** Resolve a bet against a pocket: multiplier on the whole stake (0 on a loss). */
export function rouletteMultiplier(bet: RouletteBet, pocket: number): number {
  if (bet.type !== "multi") {
    return rouletteBetWins(bet, pocket) ? roulettePayoutMultiplier(bet) : 0;
  }
  let staked = 0;
  let returned = 0;
  for (const { bet: b, weight } of bet.bets) {
    staked += weight;
    if (rouletteBetWins(b, pocket)) returned += weight * roulettePayoutMultiplier(b);
  }
  return returned / staked;
}

export function playRoulette(
  ctx: BetContext,
  bet: RouletteBet,
): GameResult<RouletteOutcome> {
  validateRouletteBet(bet);
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const pocket = Math.floor(u * 37); // 0..36
  const multiplier = rouletteMultiplier(bet, pocket);
  return {
    game: "roulette",
    outcome: { pocket, color: pocketColor(pocket) },
    win: multiplier > 0,
    multiplier,
    houseEdge: 1 / 37, // structural single-zero edge
  };
}
