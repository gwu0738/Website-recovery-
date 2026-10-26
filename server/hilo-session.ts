/**
 * HiLo sessions on the persistent session framework (server/sessions.ts).
 *
 * The committed seed fixes a stream of cards (float i → rank floor(f×13),
 * 0 = 2 … 12 = Ace; the suit is cosmetic: floor(f×52) mod 4). Start deals card
 * 0 face up and locks the stake. Each call compares the next card in the stream
 * with the current one: a right call multiplies the running multiplier by the
 * exact odds of that call ((1 − edge) / P), the new card becomes the base, and
 * the player can cash out; a wrong call loses the stake. The single-round
 * engine in src/games/hilo.ts uses the same per-call payout.
 */
import { HOUSE_EDGE } from "../src/config.ts";
import { floats } from "../src/fairness/engine.ts";
import { RANKS, type HiLoGuess } from "../src/games/hilo.ts";
import { floor2 } from "../src/games/shared.ts";
import type { BetContext } from "../src/games/types.ts";
import {
  SessionError,
  sessionAct,
  sessionCashout,
  sessionStart,
  type SessionGame,
} from "./sessions.ts";
import type { Account, SessionRow } from "./store.ts";

export { SessionError as HiLoError };

/** Most cards one game can run through (the stream is drawn up front). */
export const HILO_MAX_CARDS = 30;

export interface HiLoCard {
  rank: number; // 0..12
  suit: number; // 0..3, cosmetic
}

interface HiLoState {
  cards: HiLoCard[]; // the whole fixed stream — hidden beyond `dealt`
  dealt: number; // cards shown so far (>= 1: the base card)
  multiplier: number;
  calls: { guess: HiLoGuess; win: boolean }[];
}

export function hiloChance(base: number, guess: HiLoGuess): number {
  return guess === "higherOrSame" ? (RANKS - base) / RANKS : (base + 1) / RANKS;
}
export function hiloCallMultiplier(base: number, guess: HiLoGuess, houseEdge = HOUSE_EDGE): number {
  return floor2((1 / hiloChance(base, guess)) * (1 - houseEdge));
}

export function hiloCardStream(ctx: BetContext, count = HILO_MAX_CARDS): HiLoCard[] {
  return floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, count).map((f) => ({
    rank: Math.floor(f * RANKS),
    suit: Math.floor(f * 52) % 4,
  }));
}

const HILO: SessionGame<HiLoState, void, HiLoGuess> = {
  name: "hilo",
  validate() {},
  init: (ctx) => ({ cards: hiloCardStream(ctx), dealt: 1, multiplier: 1, calls: [] }),
  act(s, guess) {
    if (guess !== "higherOrSame" && guess !== "lowerOrSame") throw new SessionError("Call higherOrSame or lowerOrSame");
    const base = s.cards[s.dealt - 1].rank;
    const next = s.cards[s.dealt].rank;
    const win = guess === "higherOrSame" ? next >= base : next <= base;
    const calls = [...s.calls, { guess, win }];
    if (!win) return { state: { ...s, dealt: s.dealt + 1, calls }, bust: true };
    const multiplier = floor2(s.multiplier * hiloCallMultiplier(base, guess));
    return { state: { ...s, dealt: s.dealt + 1, multiplier, calls }, bust: false };
  },
  progress: (s) => s.calls.length,
  multiplier: (s) => s.multiplier,
  isComplete: (s) => s.dealt >= HILO_MAX_CARDS,
};

const shown = (s: HiLoState) => s.cards.slice(0, s.dealt);

export function hiloStart(acct: Account, stakeLamports: number) {
  const s = sessionStart(HILO, acct, undefined, stakeLamports);
  return {
    sessionId: s.sessionId,
    base: s.state.cards[0],
    multiplier: 1,
    balanceLamports: s.balanceLamports,
    nonceUsed: s.nonceUsed,
    serverSeedHash: s.serverSeedHash,
    clientSeed: s.clientSeed,
  };
}

export function hiloGuess(acct: Account, sessionId: string, guess: HiLoGuess) {
  const r = sessionAct(HILO, acct, sessionId, guess);
  const card = r.state.cards[r.state.dealt - 1];
  if (r.bust) {
    return { card, win: false, bust: true, multiplier: 0, cards: shown(r.state), balanceLamports: r.balanceLamports };
  }
  return {
    card,
    win: true,
    bust: false,
    multiplier: r.multiplier,
    completed: r.completed,
    payoutLamports: r.payoutLamports,
    cards: shown(r.state),
    balanceLamports: r.balanceLamports,
  };
}

export function hiloCashout(acct: Account, sessionId: string) {
  const r = sessionCashout(HILO, acct, sessionId, "Make at least one call before cashing out");
  return {
    multiplier: r.multiplier,
    cards: shown(r.state),
    payoutLamports: r.payoutLamports,
    balanceLamports: r.balanceLamports,
  };
}

/** What the player may see of an unfinished game (never the cards still to come). */
export function hiloResumeView(row: SessionRow) {
  const s = row.state as HiLoState;
  return {
    base: s.cards[s.dealt - 1],
    cards: shown(s),
    multiplier: s.multiplier,
    correct: s.calls.length,
  };
}
