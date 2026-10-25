/** Barrel export for all games and their types. */
export * from "./types.ts";
export * from "./shared.ts";
export * from "./dice.ts";
export * from "./limbo.ts";
export * from "./crash.ts";
export * from "./mines.ts";
export * from "./plinko.ts";
export * from "./roulette.ts";
export * from "./wheel.ts";
export * from "./coinflip.ts";

export const GAMES = [
  "dice",
  "limbo",
  "crash",
  "mines",
  "plinko",
  "roulette",
  "wheel",
  "coinflip",
] as const;

export type GameName = (typeof GAMES)[number];
