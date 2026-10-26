// End-to-end real-SOL check: real transactions against a Solana cluster.
//
//   node scripts/sol-e2e.mjs                 # local validator at 127.0.0.1:8899
//   SOLANA_RPC_URL=... SOLANA_CLUSTER=devnet node scripts/sol-e2e.mjs
//
// Generates THROWAWAY house + player keypairs in a temp dir (never in the repo),
// funds them by airdrop, starts the real server against the chain, then:
// sign in -> deposit (on-chain transfer, verified + credited) -> replayed
// deposit refused -> bet -> withdraw (on-chain payout) -> faucet bonus blocks
// withdrawal. Every money movement is checked against on-chain balances.
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { spawn } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { base58Encode } = await import(join(ROOT, "server/lib/base58.ts"));

const CLUSTER = process.env.SOLANA_CLUSTER ?? "localnet";
const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const PORT = Number(process.env.E2E_PORT ?? 8865);
const API = `http://127.0.0.1:${PORT}`;
const conn = new Connection(RPC, "confirmed");
const SOL = LAMPORTS_PER_SOL;
const fmt = (l) => (l / SOL).toFixed(6) + " SOL";

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}`);
  if (!ok) failures++;
};

async function airdrop(pubkey, sol) {
  const sig = await conn.requestAirdrop(pubkey, sol * SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

function signMessage(kp, message) {
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const key = createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", d: b64u(kp.secretKey.slice(0, 32)), x: b64u(kp.publicKey.toBytes()) },
    format: "jwk",
  });
  return base58Encode(new Uint8Array(sign(null, Buffer.from(message, "utf8"), key)));
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

// ---- setup: throwaway keys + funding ----
const dir = mkdtempSync(join(tmpdir(), "vanta-e2e-"));
const house = Keypair.generate();
const player = Keypair.generate();
const houseFile = join(dir, "house.keypair.json");
writeFileSync(houseFile, JSON.stringify([...house.secretKey]));
chmodSync(houseFile, 0o600);
console.log(`cluster ${CLUSTER} @ ${RPC}`);
console.log(`house  ${house.publicKey.toBase58()}\nplayer ${player.publicKey.toBase58()}`);
await airdrop(house.publicKey, 5);
await airdrop(player.publicKey, 2);

const server = spawn(process.execPath, [join(ROOT, "server/server.ts")], {
  env: {
    ...process.env, PORT: String(PORT), VANTA_DATA_DIR: dir, NODE_NO_WARNINGS: "1",
    SOLANA_CLUSTER: CLUSTER, SOLANA_RPC_URL: RPC, HOUSE_KEYPAIR_FILE: houseFile,
  },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(API + "/api/health")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("\n1. config + sign-in");
  const cfg = (await api("/api/config")).body;
  check(cfg.houseAddress === house.publicKey.toBase58(), `server reports house address ${cfg.houseAddress}`);
  const { message } = (await api(`/api/auth/challenge?pubkey=${player.publicKey.toBase58()}`)).body;
  const login = await api("/api/auth/verify", {
    method: "POST", body: { pubkey: player.publicKey.toBase58(), signature: signMessage(player, message) },
  });
  check(login.status === 200 && !!login.body.token, "player signs in with their wallet");
  const token = login.body.token;

  console.log("\n2. deposit 0.5 SOL (real on-chain transfer)");
  const depTx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: player.publicKey, toPubkey: house.publicKey, lamports: 0.5 * SOL,
  }));
  const depSig = await sendAndConfirmTransaction(conn, depTx, [player], { commitment: "confirmed" });
  console.log(`   tx ${depSig}`);
  const dep = await api("/api/deposit/confirm", { method: "POST", token, body: { signature: depSig } });
  check(dep.status === 200 && dep.body.creditedLamports === 0.5 * SOL, `credited ${fmt(dep.body.creditedLamports ?? 0)}`);
  const replay = await api("/api/deposit/confirm", { method: "POST", token, body: { signature: depSig } });
  check(replay.status === 400 && /already credited/.test(replay.body.error), "the same deposit can't be credited twice");

  console.log("\n3. bet 0.05 SOL on dice");
  const bet = await api("/api/bet", {
    method: "POST", token, body: { game: "dice", bet: { target: 50, direction: "under" }, stake: 0.05 * SOL },
  });
  check(bet.status === 200, `dice rolled ${bet.body.result?.outcome?.roll} → ${bet.body.result?.win ? "win" : "loss"}, balance ${fmt(bet.body.balanceLamports)}`);
  const expectedAfterBet = 0.5 * SOL - 0.05 * SOL + bet.body.payoutLamports;
  check(bet.body.balanceLamports === expectedAfterBet, "ledger = deposit − stake + payout");

  console.log("\n4. withdraw 0.2 SOL (real on-chain payout)");
  const playerBefore = await conn.getBalance(player.publicKey, "confirmed");
  const houseBefore = await conn.getBalance(house.publicKey, "confirmed");
  const wd = await api("/api/withdraw", { method: "POST", token, body: { lamports: 0.2 * SOL } });
  check(wd.status === 200 && wd.body.status === "sent", `withdrawal ${wd.body.status ?? wd.body.error} tx ${wd.body.signature ?? ""}`);
  const playerAfter = await conn.getBalance(player.publicKey, "confirmed");
  const houseAfter = await conn.getBalance(house.publicKey, "confirmed");
  check(playerAfter - playerBefore === 0.2 * SOL, `player wallet +${fmt(playerAfter - playerBefore)} on-chain`);
  check(houseBefore - houseAfter >= 0.2 * SOL, `house wallet −${fmt(houseBefore - houseAfter)} (0.2 + network fee)`);
  check(wd.body.balanceLamports === expectedAfterBet - 0.2 * SOL, `account balance now ${fmt(wd.body.balanceLamports)}`);

  console.log("\n5. faucet bonus blocks withdrawal until wagered");
  const fc = await api("/api/faucet", { method: "POST", token });
  check(fc.status === 200 && fc.body.wagerRemaining > 0, `faucet +${fmt(fc.body.creditedLamports ?? 0)}, must wager ${fmt(fc.body.wagerRemaining ?? 0)} first`);
  const blocked = await api("/api/withdraw", { method: "POST", token, body: { lamports: 0.01 * SOL } });
  check(blocked.status === 400 && /wager/i.test(blocked.body.error), "withdrawal refused while bonus is unwagered");

  console.log("\n6. history");
  const w = (await api("/api/wallet", { token })).body;
  check(w.deposits.length === 1 && w.withdrawals.length === 1 && w.withdrawals[0].status === "sent",
    `wallet shows ${w.deposits.length} deposit, ${w.withdrawals.length} withdrawal (${w.withdrawals[0]?.status})`);
} finally {
  server.kill();
}

console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ all real-SOL checks passed");
process.exit(failures ? 1 : 0);
