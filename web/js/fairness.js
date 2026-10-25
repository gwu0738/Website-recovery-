// =============================================================================
// Browser fairness engine — the same provably-fair scheme as the Node engine,
// implemented with the Web Crypto API so it runs client-side with no deps.
//
//   HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${cursor}`)
//
// Each HMAC gives 32 bytes -> eight floats in [0, 1). This mirrors
// src/fairness/engine.ts exactly, so results match the server and tests.
// =============================================================================

const enc = new TextEncoder();

async function hmacBytes(serverSeed, clientSeed, nonce, cursor) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(serverSeed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${clientSeed}:${nonce}:${cursor}`),
  );
  return new Uint8Array(sig);
}

/** sha256(serverSeed) as hex — the commitment shown before play. */
export async function hashServerSeed(serverSeed) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(serverSeed));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Draw `count` uniform floats in [0, 1) for a bet. */
export async function floats(serverSeed, clientSeed, nonce, count) {
  const out = [];
  let cursor = 0;
  let buf = await hmacBytes(serverSeed, clientSeed, nonce, cursor);
  let i = 0;
  while (out.length < count) {
    if (i + 4 > buf.length) {
      cursor++;
      buf = await hmacBytes(serverSeed, clientSeed, nonce, cursor);
      i = 0;
    }
    let value = 0;
    for (let k = 0; k < 4; k++) value += buf[i + k] / Math.pow(256, k + 1);
    out.push(value);
    i += 4;
  }
  return out;
}

/** Random hex string of `bytes` length — for generating seeds in-browser. */
export function randomHex(bytes = 8) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyCommitment(serverSeed, serverSeedHash) {
  return (await hashServerSeed(serverSeed)) === serverSeedHash;
}
