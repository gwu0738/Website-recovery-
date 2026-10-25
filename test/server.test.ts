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
  rmSync(process.env.VANTA_DATA_DIR!, { recursive: true, force: true });
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
