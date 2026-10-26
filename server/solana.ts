/**
 * The Solana side of real money: the only module that touches the house wallet
 * key or the network.
 *
 * House key: HOUSE_KEYPAIR_FILE (path to a keypair JSON array, kept OUT of the
 * repo — see .gitignore) or HOUSE_SECRET_KEY (base58 or JSON array). It's
 * loaded lazily, never logged, never returned by any API. Use a dedicated
 * throwaway hot wallet holding only what you're willing to lose.
 *
 * Everything else in the server talks to the `Chain` interface, so tests can
 * swap in a fake chain and the money logic (server/wallet.ts) stays testable.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Commitment,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { CLUSTER } from "./config.ts";
import { base58Decode, base58Encode } from "./lib/base58.ts";

export interface Chain {
  /** The house wallet address deposits go to. */
  houseAddress(): string;
  /** House wallet balance in lamports. */
  houseBalance(): Promise<number>;
  /** Confirm `signature` moved SOL from `from` to the house; returns the amount. */
  verifyDeposit(signature: string, from: string): Promise<{ lamports: number; slot: number }>;
  /**
   * Send `lamports` from the house to `to`. `onSigned` receives the transaction
   * signature BEFORE it's broadcast, so the caller can record it first.
   */
  sendWithdrawal(to: string, lamports: number, onSigned: (signature: string) => void): Promise<string>;
  /** Final state of a sent signature: landed, failed on-chain, or not found. */
  signatureStatus(signature: string): Promise<"landed" | "failed" | "missing">;
}

export class ChainError extends Error {}
/** Thrown when a withdrawal certainly never landed (blockhash expired, not found). */
export class WithdrawalDroppedError extends ChainError {}

const DEFAULT_RPC: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

const chainSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadHouseKeypair(): Keypair {
  const raw = process.env.HOUSE_SECRET_KEY?.trim();
  const file = process.env.HOUSE_KEYPAIR_FILE;
  let bytes: Uint8Array;
  if (raw) bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : base58Decode(raw);
  else if (file) bytes = Uint8Array.from(JSON.parse(readFileSync(file, "utf8")));
  else throw new ChainError("House wallet not configured (set HOUSE_KEYPAIR_FILE or HOUSE_SECRET_KEY)");
  if (bytes.length !== 64) throw new ChainError("House secret key must be 64 bytes");
  return Keypair.fromSecretKey(bytes);
}

export function isHouseConfigured(): boolean {
  return !!(process.env.HOUSE_SECRET_KEY || process.env.HOUSE_KEYPAIR_FILE);
}

export function createSolanaChain(): Chain {
  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC[CLUSTER], "confirmed");
  // Credit deposits only once they can't be rolled back on mainnet.
  const depositCommitment: Commitment = CLUSTER === "mainnet" ? "finalized" : "confirmed";
  let house: Keypair | null = null;
  const getHouse = () => (house ??= loadHouseKeypair());

  return {
    houseAddress: () => getHouse().publicKey.toBase58(),

    houseBalance: () => connection.getBalance(getHouse().publicKey, "confirmed"),

    async verifyDeposit(signature, from) {
      // A just-sent transaction can take a few seconds to become visible.
      let tx = null;
      for (let i = 0; i < 15 && !tx; i++) {
        tx = await connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: depositCommitment as "confirmed" | "finalized",
        });
        if (!tx) await chainSleep(2000);
      }
      if (!tx) throw new ChainError("Deposit not found on-chain yet — try again in a moment");
      if (tx.meta?.err) throw new ChainError("That transaction failed on-chain");

      const houseAddr = getHouse().publicKey.toBase58();
      let lamports = 0;
      for (const ix of tx.transaction.message.instructions) {
        if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
          const info = ix.parsed.info as { source: string; destination: string; lamports: number };
          // The source must sign the transfer, so this proves the player sent it.
          if (info.source === from && info.destination === houseAddr) lamports += Number(info.lamports);
        }
      }
      if (lamports <= 0) {
        throw new ChainError("No transfer from your wallet to the house address in that transaction");
      }
      return { lamports, slot: tx.slot };
    },

    async sendWithdrawal(to, lamports, onSigned) {
      const houseKp = getHouse();
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: houseKp.publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: houseKp.publicKey, toPubkey: new PublicKey(to), lamports }),
      );
      tx.sign(houseKp);
      const signature = base58Encode(tx.signature!);
      onSigned(signature); // recorded before broadcast — no unknown payouts

      try {
        await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      } catch (e) {
        // The RPC refused it at preflight: it was never accepted, so it can't land.
        if ((e as Error).name === "SendTransactionError") {
          throw new WithdrawalDroppedError(`Rejected by RPC: ${(e as Error).message}`);
        }
        throw e; // network trouble: outcome uncertain, caller leaves it pending
      }
      try {
        const res = await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (res.value.err) throw new ChainError("Withdrawal failed on-chain");
      } catch (e) {
        if ((e as Error).name === "TransactionExpiredBlockheightExceededError") {
          // The blockhash expired; if the network still has no record of it,
          // it can never land, so a refund is safe.
          if ((await this.signatureStatus(signature)) === "missing") {
            throw new WithdrawalDroppedError("Withdrawal expired before landing");
          }
        }
        throw e;
      }
      return signature;
    },

    async signatureStatus(signature) {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const st = value[0];
      if (!st) return "missing";
      if (st.err) return "failed";
      return st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" ? "landed" : "missing";
    },
  };
}
