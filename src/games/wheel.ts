/**
 * Wheel — a wheel split into equal segments, each carrying a multiplier. One
 * float selects the landing segment.
 *
 * Segment layouts are defined per risk level. Change the arrays to re-skin the
 * wheel; the selection logic and fairness engine stay the same.
 */
import { floats } from "../fairness/engine.ts";
import type { BetContext, GameResult } from "./types.ts";

export type WheelRisk = "low" | "medium" | "high";

/** Equal-sized segments going around the wheel, by risk level. */
export const WHEEL_SEGMENTS: Record<WheelRisk, number[]> = {
  low: [1.5, 1.2, 1.5, 0, 1.5, 1.2, 1.5, 0, 1.5, 1.2, 1.5, 0],
  medium: [0, 1.9, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.9],
  high: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48],
};

export interface WheelBet {
  risk: WheelRisk;
}

export interface WheelOutcome {
  segment: number;
  multiplier: number;
  risk: WheelRisk;
}

export function playWheel(
  ctx: BetContext,
  bet: WheelBet,
): GameResult<WheelOutcome> {
  const segments = WHEEL_SEGMENTS[bet.risk];
  if (!segments) throw new Error(`Unknown wheel risk: ${bet.risk}`);
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const segment = Math.floor(u * segments.length);
  const multiplier = segments[segment];
  return {
    game: "wheel",
    outcome: { segment, multiplier, risk: bet.risk },
    win: multiplier >= 1,
    multiplier,
    houseEdge: 0, // edge is baked into the segment layout
  };
}
