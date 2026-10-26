// The browser engine (web/js/fairness.js) must produce the same bytes and
// floats as the Node engine on BOTH of its paths: Web Crypto, and the pure-JS
// SHA-256/HMAC it falls back to on plain-http pages (no crypto.subtle).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";

const browser = await import("../web/js/fairness.js");
const { floats: nodeFloats, hashServerSeed: nodeHash } = await import("../src/fairness/engine.ts");

test("pure-JS SHA-256 and HMAC match Node's crypto (short, block-boundary, long inputs)", () => {
  const lengths = [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000];
  for (const n of lengths) {
    const msg = new Uint8Array(randomBytes(n));
    assert.equal(Buffer.from(browser.sha256Sync(msg)).toString("hex"), createHash("sha256").update(msg).digest("hex"), `sha256 len ${n}`);
    for (const keyLen of [1, 32, 64, 65, 200]) {
      const key = new Uint8Array(randomBytes(keyLen));
      assert.equal(
        Buffer.from(browser.hmacSha256Sync(key, msg)).toString("hex"),
        createHmac("sha256", key).update(msg).digest("hex"),
        `hmac key ${keyLen} msg ${n}`,
      );
    }
  }
});

test("browser floats equal the Node engine's on both paths, across HMAC blocks", async () => {
  const serverSeed = "a".repeat(64), clientSeed = "player-seed", nonce = 7;
  const want = nodeFloats(serverSeed, clientSeed, nonce, 40); // 5 HMAC blocks
  assert.deepEqual(await browser.floats(serverSeed, clientSeed, nonce, 40), want);
  assert.deepEqual(browser.floatsSync(serverSeed, clientSeed, nonce, 40), want);
  assert.equal(await browser.hashServerSeed(serverSeed), nodeHash(serverSeed));
  assert.equal(browser.hashServerSeedSync(serverSeed), nodeHash(serverSeed));
});
