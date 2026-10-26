// Integration test for the backend: wallet sign-in -> faucet -> bet.
// Uses a throwaway ed25519 keypair to simulate a Phantom wallet, and an
// isolated data dir so it never touches real account data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VANTA_DATA_DIR = mkdtempSync(join(tmpdir(), "vanta-test-"));
process.env.FAUCET_POW_BITS = "0"; // the proof-of-work gate has its own test

const { start } = await import("../server/server.ts");
const { base58Encode } = await import("../server/lib/base58.ts");

let base: string;
let httpServer: ReturnType<typeof start>;
let priv: KeyObject;
let pubB58: string;

before(async () => {
  const kp = generateKeyPairSync("ed25519");
  priv = kp.privateKey;
  // Raw 32-byte ed25519 public key -> base58 (Solana address format).
  const jwk = kp.publicKey.export({ format: "jwk" }) as { x: string };
  const rawPub = Buffer.from(jwk.x, "base64url");
  pubB58 = base58Encode(new Uint8Array(rawPub));

  httpServer = start(0); // port 0 => random free port
  await new Promise((r) => httpServer.once("listening", r));
  const addr = httpServer.address() as { port: number };
  base = `http://localhost:${addr.port}`;
});

after(() => {
  httpServer.close();
  // Best-effort: on Windows the open SQLite handle can hold the temp dir, so a
  // failed cleanup must not fail the test. The OS reclaims the temp dir anyway.
  try {
    rmSync(process.env.VANTA_DATA_DIR!, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* ignore — OS temp dir, cleaned up later */
  }
});

const j = async (res: Response) => ({ status: res.status, body: await res.json() });

test("wallet sign-in with a valid signature issues a token", async () => {
  const ch = await j(await fetch(`${base}/api/auth/challenge?pubkey=${pubB58}`));
  assert.equal(ch.status, 200);
  const message = Buffer.from(ch.body.message, "utf8");
  const signature = sign(null, message, priv); // ed25519
  const sigB58 = base58Encode(new Uint8Array(signature));

  const v = await j(
    await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: pubB58, signature: sigB58 }),
    }),
  );
  assert.equal(v.status, 200);
  assert.ok(v.body.token, "should return a session token");
  assert.equal(v.body.account.pubkey, pubB58);
  assert.equal(v.body.account.balanceLamports, 0);
});

test("a forged signature is rejected", async () => {
  await fetch(`${base}/api/auth/challenge?pubkey=${pubB58}`);
  const bad = base58Encode(new Uint8Array(64).fill(7));
  const v = await j(
    await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: pubB58, signature: bad }),
    }),
  );
  assert.equal(v.status, 401);
});

test("faucet credits balance, then a bet moves it", async () => {
  // sign in
  const ch = await (await fetch(`${base}/api/auth/challenge?pubkey=${pubB58}`)).json();
  const sigB58 = base58Encode(
    new Uint8Array(sign(null, Buffer.from(ch.message, "utf8"), priv)),
  );
  const v = await (
    await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: pubB58, signature: sigB58 }),
    })
  ).json();
  const auth = { authorization: `Bearer ${v.token}`, "content-type": "application/json" };

  // faucet
  const f = await j(await fetch(`${base}/api/faucet`, { method: "POST", headers: auth }));
  assert.equal(f.status, 200);
  assert.ok(f.body.balanceLamports > 0, "faucet should credit balance");

  // second faucet claim should be on cooldown
  const f2 = await j(await fetch(`${base}/api/faucet`, { method: "POST", headers: auth }));
  assert.equal(f2.status, 429);

  // place a dice bet
  const before = f.body.balanceLamports;
  const stake = 1_000_000;
  const b = await j(
    await fetch(`${base}/api/bet`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        game: "dice",
        bet: { target: 50, direction: "under" },
        stake,
      }),
    }),
  );
  assert.equal(b.status, 200);
  assert.equal(b.body.result.game, "dice");
  // Balance = before - stake + payout. Payout is stake*multiplier (0 on loss).
  const expected = before - stake + b.body.payoutLamports;
  assert.equal(b.body.balanceLamports, expected);
});

test("betting more than balance is rejected", async () => {
  const ch = await (await fetch(`${base}/api/auth/challenge?pubkey=${pubB58}`)).json();
  const sigB58 = base58Encode(
    new Uint8Array(sign(null, Buffer.from(ch.message, "utf8"), priv)),
  );
  const v = await (
    await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: pubB58, signature: sigB58 }),
    })
  ).json();
  const auth = { authorization: `Bearer ${v.token}`, "content-type": "application/json" };

  const b = await j(
    await fetch(`${base}/api/bet`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        game: "dice",
        bet: { target: 50, direction: "under" },
        stake: 999_999_999_999,
      }),
    }),
  );
  assert.equal(b.status, 400);
});

async function signIn() {
  const ch = await (await fetch(`${base}/api/auth/challenge?pubkey=${pubB58}`)).json();
  const sigB58 = base58Encode(new Uint8Array(sign(null, Buffer.from(ch.message, "utf8"), priv)));
  const v = await (
    await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: pubB58, signature: sigB58 }),
    })
  ).json();
  return { token: v.token as string, auth: { authorization: `Bearer ${v.token}`, "content-type": "application/json" } };
}

test("a roulette table of chips is one bet: stake = sum of chips, payout per chip odds", async () => {
  const { auth } = await signIn();
  const me = await (await fetch(`${base}/api/me`, { headers: auth })).json();
  const before = me.account.balanceLamports;
  const chips = [
    { bet: { type: "red" }, weight: 600_000 },
    { bet: { type: "straight", number: 0 }, weight: 100_000 },
    { bet: { type: "dozen", dozen: 2 }, weight: 300_000 },
  ];
  const b = await j(
    await fetch(`${base}/api/bet`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ game: "roulette", bet: { type: "multi", bets: chips }, stake: 1_000_000 }),
    }),
  );
  assert.equal(b.status, 200);
  const pocket = b.body.result.outcome.pocket;
  let expectedPayout = 0;
  if (pocket !== 0 && [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(pocket)) expectedPayout += 600_000 * 2;
  if (pocket === 0) expectedPayout += 100_000 * 36;
  if (pocket >= 13 && pocket <= 24) expectedPayout += 300_000 * 3;
  assert.equal(b.body.payoutLamports, expectedPayout, `pocket ${pocket}`);
  assert.equal(b.body.balanceLamports, before - 1_000_000 + expectedPayout);

  const bad = await j(
    await fetch(`${base}/api/bet`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ game: "roulette", bet: { type: "straight", number: 40 }, stake: 1_000_000 }),
    }),
  );
  assert.equal(bad.status, 400);
});

test("an unfinished game shows up in /api/sessions/active with its public progress", async () => {
  const { auth } = await signIn();
  const s = await j(
    await fetch(`${base}/api/tower/start`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ difficulty: "easy", stake: 1_000_000 }),
    }),
  );
  assert.equal(s.status, 200);
  const list = await (await fetch(`${base}/api/sessions/active`, { headers: auth })).json();
  const mine = list.sessions.find((x: any) => x.sessionId === s.body.sessionId);
  assert.ok(mine, "the locked-stake game is listed for resuming");
  assert.equal(mine.stakeLamports, 1_000_000);
  assert.deepEqual(
    { difficulty: mine.progress.difficulty, rowsClimbed: mine.progress.rowsClimbed, multiplier: mine.progress.multiplier },
    { difficulty: "easy", rowsClimbed: 0, multiplier: 1 },
  );
  assert.equal("layout" in mine.progress, false, "hidden layout never leaves the server");
});

test("sign-out revokes the token; a new sign-in finds the same balance", async () => {
  const { token, auth } = await signIn();
  const me = await (await fetch(`${base}/api/me`, { headers: auth })).json();
  const out = await j(await fetch(`${base}/api/auth/logout`, { method: "POST", headers: auth }));
  assert.equal(out.status, 200);
  const after = await j(await fetch(`${base}/api/me`, { headers: auth }));
  assert.equal(after.status, 401, `token ${token.slice(0, 6)}… no longer resolves`);
  const again = await signIn();
  const me2 = await (await fetch(`${base}/api/me`, { headers: again.auth })).json();
  assert.equal(me2.account.balanceLamports, me.account.balanceLamports);
});
