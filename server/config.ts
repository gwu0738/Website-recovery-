/**
 * Backend config. Everything money-related can be set from environment
 * variables, with safe defaults per Solana cluster. Secrets (the house wallet
 * key) are read in server/solana.ts from env/untracked files and are NEVER
 * committed or logged.
 *
 *   SOLANA_CLUSTER   localnet | devnet | mainnet        (default devnet)
 *   SOLANA_RPC_URL   override the RPC endpoint (use your provider/node on mainnet)
 *   FAUCET_LAMPORTS  free credit per claim; 0 disables the faucet
 *   MIN_STAKE_LAMPORTS / MAX_STAKE_LAMPORTS
 *   MIN_WITHDRAW_LAMPORTS
 *   HOUSE_RESERVE_LAMPORTS  kept in the house wallet, never paid out
 *   CORS_ORIGIN      your site's origin (default "*"); see deploy/DEPLOY.md
 *   FAUCET_POW_BITS  proof-of-work difficulty for faucet claims (default 18; 0 = off)
 *   TURNSTILE_SECRET use Cloudflare Turnstile for the faucet instead (see server/faucet-guard.ts)
 */
import { HOUSE_EDGE } from "../src/config.ts";

const env = (name: string, fallback: number) => {
  const v = process.env[name];
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
};

export type Cluster = "localnet" | "devnet" | "mainnet";
export const CLUSTER: Cluster = (["localnet", "devnet", "mainnet"].includes(process.env.SOLANA_CLUSTER ?? "")
  ? process.env.SOLANA_CLUSTER
  : "devnet") as Cluster;
const MAINNET = CLUSTER === "mainnet";

export const SERVER = {
  port: Number(process.env.PORT ?? 8787),
};

export const FAUCET = {
  /**
   * Free credit per claim, in lamports (1 SOL = 1_000_000_000). On mainnet this
   * is real SOL once wagered through, so the default is tiny (0.0001 SOL).
   */
  amountLamports: env("FAUCET_LAMPORTS", MAINNET ? 100_000 : 50_000_000),
  /** How often a user can claim, in milliseconds. */
  cooldownMs: env("FAUCET_COOLDOWN_MS", 1000 * 60 * 3), // 3 minutes (reference cadence)
  /**
   * Wagering requirement: each claim adds amount × this to the account's
   * wagerRemaining, and withdrawals are blocked until it's wagered down to 0.
   */
  wagerRequirementX: env("FAUCET_WAGER_X", 10),
  /** Faucet requires a verified email (email layer not built yet; informational). */
  requireVerifiedEmail: true,
};

export const BET = {
  minStakeLamports: env("MIN_STAKE_LAMPORTS", 1_000), // 0.000001 SOL
  maxStakeLamports: env("MAX_STAKE_LAMPORTS", MAINNET ? 10_000_000 : 100_000_000), // 0.01 / 0.1 SOL
  houseEdge: HOUSE_EDGE,
};

export const WITHDRAW = {
  minLamports: env("MIN_WITHDRAW_LAMPORTS", 1_000_000), // 0.001 SOL
  /** Left in the house wallet for fees/rent; never paid out to players. */
  houseReserveLamports: env("HOUSE_RESERVE_LAMPORTS", 5_000_000), // 0.005 SOL
};

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const toSol = (lamports: number) => lamports / LAMPORTS_PER_SOL;
