/**
 * Backend config. Secrets (like the house wallet key, Phase 2) come from env
 * vars and are NEVER committed. Everything here is safe to commit.
 */
import { HOUSE_EDGE } from "../src/config.ts";

export const SERVER = {
  port: Number(process.env.PORT ?? 8787),
};

export const FAUCET = {
  /** Free amount credited per claim, in lamports (1 SOL = 1_000_000_000). */
  amountLamports: 50_000_000, // 0.05 "SOL" of test credit
  /** How often a user can claim, in milliseconds. */
  cooldownMs: 1000 * 60 * 60, // 1 hour
  /**
   * Wagering requirement multiple before faucet credit can be withdrawn
   * (Phase 2). 0 = none. Mirrors how real faucets lock free credit.
   */
  wagerRequirementX: 10,
};

export const BET = {
  minStakeLamports: 1_000, // 0.000001
  maxStakeLamports: 100_000_000, // 0.1 — keep test stakes small
  houseEdge: HOUSE_EDGE,
};

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const toSol = (lamports: number) => lamports / LAMPORTS_PER_SOL;
