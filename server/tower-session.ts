/**
 * Tower sessions on the persistent session framework (server/sessions.ts):
 * start debits the stake and fixes the trap layout from the committed seed;
 * reveal climbs or busts; cashout pays stake x multiplier. Stakes survive a
 * server restart and every money movement is transactional.
 */
import {
  towerLayout,
  towerMultiplier,
  towerMaxMultiplier,
  TOWER_COLS,
  TOWER_ROWS,
  TOWER_TRAPS,
  type TowerDifficulty,
} from "../src/games/tower.ts";
import {
  SessionError,
  sessionAct,
  sessionCashout,
  sessionStart,
  type SessionGame,
} from "./sessions.ts";
import type { Account } from "./store.ts";

export { SessionError as TowerError };

interface TowerState {
  difficulty: TowerDifficulty;
  layout: number[][]; // trap tiles per row — hidden until the game ends
  rowsClimbed: number;
  picks: number[];
}

const TOWER: SessionGame<TowerState, TowerDifficulty, number> = {
  name: "tower",
  validate(difficulty) {
    if (TOWER_TRAPS[difficulty] === undefined) throw new SessionError("Unknown difficulty");
  },
  init: (ctx, difficulty) => ({
    difficulty,
    layout: towerLayout(ctx, difficulty),
    rowsClimbed: 0,
    picks: [],
  }),
  act(s, pick) {
    if (!Number.isInteger(pick) || pick < 0 || pick >= TOWER_COLS) {
      throw new SessionError("Invalid tile");
    }
    const picks = [...s.picks, pick];
    if (s.layout[s.rowsClimbed].includes(pick)) return { state: { ...s, picks }, bust: true };
    return { state: { ...s, picks, rowsClimbed: s.rowsClimbed + 1 }, bust: false };
  },
  progress: (s) => s.rowsClimbed,
  multiplier: (s) => towerMultiplier(s.difficulty, s.rowsClimbed),
  isComplete: (s) => s.rowsClimbed >= TOWER_ROWS,
};

export function towerStart(acct: Account, difficulty: TowerDifficulty, stakeLamports: number) {
  const s = sessionStart(TOWER, acct, difficulty, stakeLamports);
  return {
    sessionId: s.sessionId,
    difficulty,
    cols: TOWER_COLS,
    rows: TOWER_ROWS,
    traps: TOWER_TRAPS[difficulty],
    maxMultiplier: towerMaxMultiplier(difficulty),
    currentMultiplier: 1,
    balanceLamports: s.balanceLamports,
    nonceUsed: s.nonceUsed,
    serverSeedHash: s.serverSeedHash,
    clientSeed: s.clientSeed,
  };
}

export function towerReveal(acct: Account, sessionId: string, pick: number) {
  const r = sessionAct(TOWER, acct, sessionId, pick);
  const row = r.prev.rowsClimbed;
  const rowTraps = r.prev.layout[row]; // the row just played only — no future leak
  if (r.bust) {
    return {
      safe: false,
      bust: true,
      row,
      pick,
      rowTraps,
      multiplier: 0,
      rowsClimbed: row,
      balanceLamports: r.balanceLamports,
    };
  }
  return {
    safe: true,
    bust: false,
    row,
    pick,
    rowTraps,
    multiplier: r.multiplier,
    rowsClimbed: r.state.rowsClimbed,
    completed: r.completed,
    payoutLamports: r.payoutLamports,
    balanceLamports: r.balanceLamports,
  };
}

export function towerCashout(acct: Account, sessionId: string) {
  const r = sessionCashout(TOWER, acct, sessionId, "Climb at least one row before cashing out");
  return {
    multiplier: r.multiplier,
    rowsClimbed: r.state.rowsClimbed,
    payoutLamports: r.payoutLamports,
    balanceLamports: r.balanceLamports,
  };
}
