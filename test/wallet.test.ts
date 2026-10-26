// Deposit/withdrawal rules against a fake chain, so every failure path can be
// forced: double-credit, wrong sender, wagering requirement, solvency, and the
// three outcomes of a failed send (definitely dropped / uncertain / actually landed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VANTA_DATA_DIR = mkdtempSync(join(tmpdir(), "vanta-wallet-"));

const { getOrCreateAccount, getAccount, save, myWithdrawals } = await import("../server/store.ts");
const { confirmDeposit, requestWithdrawal } = await import("../server/wallet.ts");
const { WithdrawalDroppedError } = await import("../server/solana.ts");
const { claimFaucet, placeBet } = await import("../server/bets.ts");
const { FAUCET, WITHDRAW } = await import("../server/config.ts");

const SIG = (c: string) => c.repeat(88); // valid-looking base58 signatures
type Opts = {
  deposits?: Record<string, { from: string; lamports: number }>;
  houseBalance?: number;
  sendError?: Error;
  status?: "landed" | "failed" | "missing";
};
function fakeChain(o: Opts = {}) {
  const sent: { to: string; lamports: number }[] = [];
  return {
    sent,
    houseAddress: () => "HouseAddress1111111111111111111111111111111",
    houseBalance: async () => o.houseBalance ?? 1_000_000_000_000,
    verifyDeposit: async (sig: string, from: string) => {
      const d = o.deposits?.[sig];
      if (!d || d.from !== from) throw new Error("No transfer from your wallet to the house address");
      return { lamports: d.lamports, slot: 1 };
    },
    sendWithdrawal: async (to: string, lamports: number, onSigned: (s: string) => void) => {
      onSigned(SIG("W"));
      if (o.sendError) throw o.sendError;
      sent.push({ to, lamports });
      return SIG("W");
    },
    signatureStatus: async () => o.status ?? "missing",
  };
}
const funded = (pk: string, lamports: number) => {
  const a = getOrCreateAccount(pk);
  a.balanceLamports = lamports;
  save(a);
  return getAccount(pk)!;
};

test("a deposit is credited once, for exactly the on-chain amount", async () => {
  const a = funded("Depositor", 0);
  const chain = fakeChain({ deposits: { [SIG("D")]: { from: "Depositor", lamports: 25_000_000 } } });
  const r = await confirmDeposit(a, SIG("D"), chain);
  assert.equal(r.creditedLamports, 25_000_000);
  assert.equal(getAccount("Depositor")!.balanceLamports, 25_000_000);
  await assert.rejects(confirmDeposit(a, SIG("D"), chain), /already credited/);
  assert.equal(getAccount("Depositor")!.balanceLamports, 25_000_000);
});

test("someone else's transfer, or a malformed signature, is rejected", async () => {
  const a = funded("NotTheSender", 0);
  const chain = fakeChain({ deposits: { [SIG("E")]: { from: "SomeoneElse", lamports: 9_000_000 } } });
  await assert.rejects(confirmDeposit(a, SIG("E"), chain), /No transfer from your wallet/);
  await assert.rejects(confirmDeposit(a, "not-a-signature", chain), /Invalid transaction signature/);
  assert.equal(getAccount("NotTheSender")!.balanceLamports, 0);
});

test("a withdrawal debits the balance and pays out on-chain", async () => {
  const a = funded("Withdrawer", 50_000_000);
  const chain = fakeChain();
  const r = await requestWithdrawal(a, 20_000_000, chain);
  assert.equal(r.status, "sent");
  assert.deepEqual(chain.sent, [{ to: "Withdrawer", lamports: 20_000_000 }]);
  assert.equal(getAccount("Withdrawer")!.balanceLamports, 30_000_000);
  assert.equal(myWithdrawals("Withdrawer")[0].status, "sent");
});

test("faucet bonus must be wagered through before any withdrawal", async () => {
  const a = funded("BonusHunter", 0);
  claimFaucet(a);
  const need = FAUCET.amountLamports * FAUCET.wagerRequirementX;
  assert.equal(getAccount("BonusHunter")!.wagerRemaining, need);
  await assert.rejects(requestWithdrawal(a, WITHDRAW.minLamports, fakeChain()), /faucet bonus requirement/);

  // Wager it through (fund enough that the test can't run dry).
  const b = funded("BonusHunter", 10_000_000_000);
  let left = need;
  while (left > 0) {
    const stake = Math.min(100_000_000, left);
    placeBet(b, { game: "coinflip", bet: { call: "heads" } }, stake);
    left -= stake;
  }
  assert.equal(getAccount("BonusHunter")!.wagerRemaining, 0);
  const r = await requestWithdrawal(b, WITHDRAW.minLamports, fakeChain());
  assert.equal(r.status, "sent");
});

test("limits: minimum, balance, and what the house wallet can cover", async () => {
  const a = funded("Limits", 5_000_000);
  await assert.rejects(requestWithdrawal(a, WITHDRAW.minLamports - 1, fakeChain()), /Minimum withdrawal/);
  await assert.rejects(requestWithdrawal(a, 6_000_000, fakeChain()), /Insufficient balance/);
  const poorHouse = fakeChain({ houseBalance: WITHDRAW.houseReserveLamports + 1_000_000 });
  await assert.rejects(requestWithdrawal(a, 2_000_000, poorHouse), /can't cover/);
  assert.equal(getAccount("Limits")!.balanceLamports, 5_000_000); // untouched
});

test("a send that certainly never landed is refunded", async () => {
  const a = funded("Dropped", 10_000_000);
  const chain = fakeChain({ sendError: new WithdrawalDroppedError("expired") });
  await assert.rejects(requestWithdrawal(a, 4_000_000, chain), /refunded/);
  assert.equal(getAccount("Dropped")!.balanceLamports, 10_000_000);
  assert.equal(myWithdrawals("Dropped")[0].status, "failed");
});

test("an uncertain send stays pending — no refund that could pay twice", async () => {
  const a = funded("Uncertain", 10_000_000);
  const chain = fakeChain({ sendError: new Error("socket hang up"), status: "missing" });
  const r = await requestWithdrawal(a, 4_000_000, chain);
  assert.equal(r.status, "pending");
  assert.equal(getAccount("Uncertain")!.balanceLamports, 6_000_000); // still debited
  assert.equal(myWithdrawals("Uncertain")[0].status, "pending");
  assert.equal(myWithdrawals("Uncertain")[0].signature, SIG("W")); // recorded for reconciliation
});

test("a send that errored but actually landed is marked sent, not refunded", async () => {
  const a = funded("Landed", 10_000_000);
  const chain = fakeChain({ sendError: new Error("confirm timeout"), status: "landed" });
  const r = await requestWithdrawal(a, 4_000_000, chain);
  assert.equal(r.status, "sent");
  assert.equal(getAccount("Landed")!.balanceLamports, 6_000_000);
});
