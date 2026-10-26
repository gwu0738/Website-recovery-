/**
 * Deposits and withdrawals: where account balances meet real SOL.
 *
 * Deposit: the player sends SOL from their signed-in wallet to the house
 * address, then submits the transaction signature. We verify it on-chain and
 * credit the exact amount seen. The signature is the deposit's primary key, so
 * one transfer can only ever be credited once.
 *
 * Withdrawal: checks (house can cover it, bonus wagered through, enough
 * balance), debit + record "pending" in one transaction, then send. The
 * signature is stored before broadcast, so an uncertain send is never refunded
 * blindly (that could pay twice): it's refunded only when it certainly didn't
 * land, and otherwise left "pending" for reconciliation.
 */
import { WITHDRAW, toSol } from "./config.ts";
import { WithdrawalDroppedError, type Chain } from "./solana.ts";
import {
  depositExists,
  insertDeposit,
  insertWithdrawal,
  recordWithdrawalSignature,
  reloadAccount,
  save,
  tx,
  updateWithdrawal,
  type Account,
} from "./store.ts";

export class WalletError extends Error {}

const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export async function confirmDeposit(acct: Account, signature: string, chain: Chain) {
  if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) {
    throw new WalletError("Invalid transaction signature");
  }
  if (depositExists(signature)) throw new WalletError("This deposit was already credited");

  let found;
  try {
    found = await chain.verifyDeposit(signature, acct.pubkey);
  } catch (e) {
    throw new WalletError((e as Error).message);
  }

  return tx(() => {
    reloadAccount(acct);
    // Re-check inside the transaction: two simultaneous submits of one signature.
    if (depositExists(signature)) throw new WalletError("This deposit was already credited");
    insertDeposit(signature, acct.pubkey, found.lamports, found.slot);
    acct.balanceLamports += found.lamports;
    save(acct);
    return { creditedLamports: found.lamports, balanceLamports: acct.balanceLamports, signature };
  });
}

export async function requestWithdrawal(acct: Account, lamports: number, chain: Chain) {
  if (!Number.isInteger(lamports) || lamports <= 0) throw new WalletError("Invalid amount");
  if (lamports < WITHDRAW.minLamports) {
    throw new WalletError(`Minimum withdrawal is ${toSol(WITHDRAW.minLamports)} SOL`);
  }

  // Solvency: never promise more than the house wallet can actually send.
  const houseBalance = await chain.houseBalance();
  if (houseBalance - WITHDRAW.houseReserveLamports < lamports) {
    throw new WalletError("The house wallet can't cover that withdrawal right now");
  }

  const id = tx(() => {
    reloadAccount(acct);
    if (acct.wagerRemaining > 0) {
      throw new WalletError(
        `Wager ${toSol(acct.wagerRemaining)} SOL more before withdrawing (faucet bonus requirement)`,
      );
    }
    if (lamports > acct.balanceLamports) throw new WalletError("Insufficient balance");
    acct.balanceLamports -= lamports;
    save(acct);
    return insertWithdrawal(acct.pubkey, lamports);
  });

  let signature: string | null = null;
  try {
    const sent = await chain.sendWithdrawal(acct.pubkey, lamports, (sig) => {
      signature = sig;
      recordWithdrawalSignature(id, sig); // on disk before broadcast: crash-safe reconciliation
    });
    updateWithdrawal(id, "sent", sent, null);
    return { id, status: "sent", signature: sent, lamports, balanceLamports: acct.balanceLamports };
  } catch (e) {
    const message = (e as Error).message;

    // Was it actually paid despite the error? Then it's sent, not failed.
    let status: "landed" | "failed" | "missing" | "unknown" = "unknown";
    if (e instanceof WithdrawalDroppedError) status = "missing";
    else if (signature) {
      try {
        status = await chain.signatureStatus(signature);
      } catch {
        status = "unknown";
      }
    } else status = "missing"; // never signed => never broadcast

    if (status === "landed") {
      updateWithdrawal(id, "sent", signature, null);
      return { id, status: "sent", signature, lamports, balanceLamports: acct.balanceLamports };
    }
    if (status === "failed" || (status === "missing" && (e instanceof WithdrawalDroppedError || !signature))) {
      tx(() => {
        reloadAccount(acct);
        acct.balanceLamports += lamports;
        save(acct);
        updateWithdrawal(id, "failed", signature, message);
      });
      throw new WalletError(`Withdrawal failed and was refunded: ${message}`);
    }
    // Uncertain: leave it pending (balance stays debited) rather than risk paying twice.
    return { id, status: "pending", signature, lamports, balanceLamports: acct.balanceLamports };
  }
}
