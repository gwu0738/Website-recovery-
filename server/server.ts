/**
 * Vanta backend — HTTP API for wallet sign-in, faucet, balances, and betting.
 * No framework, no dependencies: Node's built-in http server.
 *
 *   node server/server.ts        (or: npm run server)
 *
 * Phase 1: everything works on test credit (faucet) — no real SOL involved.
 * Phase 2 will add real deposits/withdrawals against a house hot wallet.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { SERVER, BET, FAUCET, WITHDRAW, CLUSTER, toSol } from "./config.ts";
import { createChallenge, verifySignature, pubkeyForToken, revokeToken } from "./auth.ts";
import {
  getOrCreateAccount,
  getAccount,
  publicView,
  myBets,
  recentBets,
  activeSessions,
  myDeposits,
  myWithdrawals,
  pendingWithdrawals,
} from "./store.ts";
import { createSolanaChain, isHouseConfigured, type Chain } from "./solana.ts";
import { confirmDeposit, requestWithdrawal, reconcilePendingWithdrawals, WalletError } from "./wallet.ts";
import { placeBet, claimFaucet, rotateSeed, setClientSeed, BetError } from "./bets.ts";
import { towerStart, towerReveal, towerCashout, towerResumeView, TowerError } from "./tower-session.ts";
import { chickenStart, chickenStep, chickenCashout, chickenResumeView, ChickenError } from "./chicken-session.ts";
import { GAMES } from "../src/games/index.ts";

const GAME_SET = new Set<string>(GAMES);

// The real-SOL side is created lazily; tests can inject a fake chain.
let chain: Chain | null = null;
export function setChain(c: Chain | null) {
  chain = c;
}
function getChain(): Chain | null {
  if (!chain && isHouseConfigured()) chain = createSolanaChain();
  return chain;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers["authorization"];
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${SERVER.port}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "OPTIONS") return send(res, 204, {});

    // ---- public ----
    if (path === "/api/health") return send(res, 200, { ok: true });

    if (path === "/api/config") {
      return send(res, 200, {
        houseEdge: BET.houseEdge,
        minStakeLamports: BET.minStakeLamports,
        maxStakeLamports: BET.maxStakeLamports,
        faucetAmountLamports: FAUCET.amountLamports,
        faucetCooldownMs: FAUCET.cooldownMs,
        faucetWagerX: FAUCET.wagerRequirementX,
        minWithdrawLamports: WITHDRAW.minLamports,
        cluster: CLUSTER,
        houseAddress: getChain()?.houseAddress() ?? null,
        games: [...GAME_SET],
      });
    }

    // Live Games feed: recent settled bets, wallet addresses shortened.
    if (path === "/api/bets/recent" && method === "GET") {
      const bets = recentBets(30).map((b) => ({
        ...b,
        pubkey: b.pubkey.slice(0, 4) + "…" + b.pubkey.slice(-4),
      }));
      return send(res, 200, { bets });
    }

    if (path === "/api/auth/challenge" && method === "GET") {
      const pubkey = url.searchParams.get("pubkey");
      if (!pubkey) return send(res, 400, { error: "pubkey required" });
      return send(res, 200, { message: createChallenge(pubkey) });
    }

    if (path === "/api/auth/verify" && method === "POST") {
      const { pubkey, signature } = await readBody(req);
      if (!pubkey || !signature) return send(res, 400, { error: "pubkey and signature required" });
      const token = verifySignature(pubkey, signature);
      if (!token) return send(res, 401, { error: "signature verification failed" });
      const acct = getOrCreateAccount(pubkey);
      return send(res, 200, { token, account: publicView(acct) });
    }

    // ---- authenticated ----
    const token = bearerToken(req);
    const pubkey = pubkeyForToken(token);
    if (!pubkey) return send(res, 401, { error: "not signed in" });
    const acct = getAccount(pubkey) ?? getOrCreateAccount(pubkey);

    if (path === "/api/me" && method === "GET") {
      return send(res, 200, { account: publicView(acct) });
    }

    // Sign out everywhere this token was used. The balance stays with the wallet.
    if (path === "/api/auth/logout" && method === "POST") {
      revokeToken(token);
      return send(res, 200, { ok: true });
    }

    // My Games: this account's settled bets (newest first).
    if (path === "/api/bets/mine" && method === "GET") {
      return send(res, 200, { bets: myBets(acct.pubkey, 50) });
    }

    // Unfinished games to resume (their stake is locked until they end). Only
    // public progress — never the hidden layout/death point, which stays
    // server-side until the game ends.
    if (path === "/api/sessions/active" && method === "GET") {
      const sessions = activeSessions(acct.pubkey).map((s) => ({
        sessionId: s.id,
        game: s.game,
        stakeLamports: s.stakeLamports,
        nonceUsed: s.nonceUsed,
        progress:
          s.game === "tower" ? towerResumeView(s)
          : s.game === "chicken" ? chickenResumeView(s)
          : null,
      }));
      return send(res, 200, { sessions });
    }

    // ---- Real SOL: wallet overview, deposits, withdrawals ----
    if (path === "/api/wallet" && method === "GET") {
      const c = getChain();
      return send(res, 200, {
        cluster: CLUSTER,
        houseAddress: c?.houseAddress() ?? null,
        balanceLamports: acct.balanceLamports,
        wagerRemaining: acct.wagerRemaining,
        deposits: myDeposits(acct.pubkey),
        withdrawals: myWithdrawals(acct.pubkey),
      });
    }
    if (path === "/api/deposit/confirm" && method === "POST") {
      const c = getChain();
      if (!c) return send(res, 503, { error: "Wallet not configured on this server" });
      const { signature } = await readBody(req);
      try {
        return send(res, 200, await confirmDeposit(acct, signature, c));
      } catch (e) {
        if (e instanceof WalletError) return send(res, 400, { error: e.message });
        throw e;
      }
    }
    if (path === "/api/withdraw" && method === "POST") {
      const c = getChain();
      if (!c) return send(res, 503, { error: "Wallet not configured on this server" });
      const { lamports } = await readBody(req);
      try {
        return send(res, 200, await requestWithdrawal(acct, Number(lamports), c));
      } catch (e) {
        if (e instanceof WalletError) return send(res, 400, { error: e.message });
        throw e;
      }
    }

    if (path === "/api/faucet" && method === "POST") {
      try {
        return send(res, 200, claimFaucet(acct));
      } catch (e) {
        return send(res, 429, { error: (e as Error).message });
      }
    }

    if (path === "/api/client-seed" && method === "POST") {
      const { clientSeed } = await readBody(req);
      try {
        setClientSeed(acct, clientSeed);
        return send(res, 200, { account: publicView(acct) });
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
    }

    if (path === "/api/rotate-seed" && method === "POST") {
      return send(res, 200, rotateSeed(acct));
    }

    if (path === "/api/bet" && method === "POST") {
      const { game, bet, stake } = await readBody(req);
      if (!GAME_SET.has(game)) return send(res, 400, { error: "unknown game" });
      try {
        const out = placeBet(acct, { game, bet } as any, Number(stake));
        return send(res, 200, out);
      } catch (e) {
        if (e instanceof BetError) return send(res, 400, { error: e.message });
        throw e;
      }
    }

    // ---- Tower (stateful, reveal-by-reveal) ----
    if (path === "/api/tower/start" && method === "POST") {
      const { difficulty, stake } = await readBody(req);
      try {
        return send(res, 200, towerStart(acct, difficulty, Number(stake)));
      } catch (e) {
        if (e instanceof TowerError) return send(res, 400, { error: e.message });
        throw e;
      }
    }
    if (path === "/api/tower/reveal" && method === "POST") {
      const { sessionId, pick } = await readBody(req);
      try {
        return send(res, 200, towerReveal(acct, sessionId, Number(pick)));
      } catch (e) {
        if (e instanceof TowerError) return send(res, 400, { error: e.message });
        throw e;
      }
    }
    if (path === "/api/tower/cashout" && method === "POST") {
      const { sessionId } = await readBody(req);
      try {
        return send(res, 200, towerCashout(acct, sessionId));
      } catch (e) {
        if (e instanceof TowerError) return send(res, 400, { error: e.message });
        throw e;
      }
    }

    // ---- Chicken (stateful, step-by-step) ----
    if (path === "/api/chicken/start" && method === "POST") {
      const { difficulty, stake } = await readBody(req);
      try {
        return send(res, 200, chickenStart(acct, difficulty, Number(stake)));
      } catch (e) {
        if (e instanceof ChickenError) return send(res, 400, { error: e.message });
        throw e;
      }
    }
    if (path === "/api/chicken/step" && method === "POST") {
      const { sessionId } = await readBody(req);
      try {
        return send(res, 200, chickenStep(acct, sessionId));
      } catch (e) {
        if (e instanceof ChickenError) return send(res, 400, { error: e.message });
        throw e;
      }
    }
    if (path === "/api/chicken/cashout" && method === "POST") {
      const { sessionId } = await readBody(req);
      try {
        return send(res, 200, chickenCashout(acct, sessionId));
      } catch (e) {
        if (e instanceof ChickenError) return send(res, 400, { error: e.message });
        throw e;
      }
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: (e as Error).message });
  }
});

export function start(port = SERVER.port) {
  // Settle withdrawals interrupted by a crash: refund what certainly never
  // landed, mark what did. Nobody's balance stays debited for a payout that
  // never happened.
  const pending = pendingWithdrawals();
  if (pending.length) {
    reconcilePendingWithdrawals(getChain())
      .then((r) => {
        console.warn(`⚠ reconciled ${pending.length} pending withdrawal(s): ${r.refunded} refunded, ${r.sent} confirmed sent, ${r.pending} still pending`);
        if (r.pending) {
          console.warn("  still pending:", pendingWithdrawals().map((w) => `#${w.id} ${w.signature ?? "(unsigned)"}`).join(", "));
        }
      })
      .catch((e) => console.error("withdrawal reconciliation failed:", (e as Error).message));
  }
  return server.listen(port, () => {
    console.log(`Vanta backend on http://localhost:${port}`);
    console.log(`Faucet: ${toSol(FAUCET.amountLamports)} per claim, ${FAUCET.cooldownMs / 60000} min cooldown`);
  });
}

// Auto-start only when run directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}

export { server };
