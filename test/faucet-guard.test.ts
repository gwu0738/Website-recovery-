// The faucet's proof-of-work gate: a correct nonce passes once, anything else
// is refused, and the browser-side solver (pure-JS sha256) agrees with Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

process.env.FAUCET_POW_BITS = "12";
const { faucetChallenge, verifyFaucetProof, powValid, leadingZeroBits } = await import("../server/faucet-guard.ts");
const { sha256Sync } = await import("../web/js/fairness.js");

function solve(challenge: string, bits: number): string {
  for (let n = 0; ; n++) {
    if (powValid(challenge, String(n), bits)) return String(n);
  }
}

test("leading zero bits are counted correctly", () => {
  assert.equal(leadingZeroBits(new Uint8Array([0, 0, 0x0f])), 20);
  assert.equal(leadingZeroBits(new Uint8Array([0x80])), 0);
  assert.equal(leadingZeroBits(new Uint8Array([0x01])), 7);
});

test("a solved challenge is accepted exactly once; wrong or stale proofs are refused", async () => {
  const c = faucetChallenge("Claimer");
  assert.equal(c.difficulty, 12);
  await assert.rejects(verifyFaucetProof("Claimer", { nonce: "nope" }), /rejected/);
  const nonce = solve(c.challenge, 12);
  await verifyFaucetProof("Claimer", { nonce }); // ok
  await assert.rejects(verifyFaucetProof("Claimer", { nonce }), /expired|rejected/); // one-time
  await assert.rejects(verifyFaucetProof("Nobody", { nonce }), /expired/);
});

test("the browser's sha256 solves the same challenge the server checks", () => {
  const c = faucetChallenge("Browser");
  const enc = new TextEncoder();
  let nonce = 0;
  for (;;) {
    const h = sha256Sync(enc.encode(`${c.challenge}:${nonce}`));
    if (leadingZeroBits(h) >= 12) break;
    nonce++;
  }
  assert.equal(powValid(c.challenge, String(nonce), 12), true);
  assert.equal(
    Buffer.from(sha256Sync(enc.encode("x"))).toString("hex"),
    createHash("sha256").update("x").digest("hex"),
  );
});
