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
import { SERVER, BET, FAUCET, toSol } from "./config.ts";
import { createChallenge, verifySignature, pubkeyForToken } from "./auth.ts";
import { getOrCreateAccount, getAccount, publicView } from "./store.ts";
import { placeBet, claimFaucet, rotateSeed, setClientSeed, BetError } from "./bets.ts";
import { GAMES } from "../src/games/index.ts";

const GAME_SET = new Set<string>(GAMES);

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

function authPubkey(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  return pubkeyForToken(token);
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
        games: [...GAME_SET],
      });
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
    const pubkey = authPubkey(req);
    if (!pubkey) return send(res, 401, { error: "not signed in" });
    const acct = getAccount(pubkey) ?? getOrCreateAccount(pubkey);

    if (path === "/api/me" && method === "GET") {
      return send(res, 200, { account: publicView(acct) });
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

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: (e as Error).message });
  }
});

export function start(port = SERVER.port) {
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
