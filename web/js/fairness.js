// =============================================================================
// Browser fairness engine — the same provably-fair scheme as the Node engine:
//
//   HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${cursor}`)
//
// Each HMAC gives 32 bytes -> eight floats in [0, 1). This mirrors
// src/fairness/engine.ts exactly, so results match the server and tests.
//
// It uses the Web Crypto API when the page has it. Browsers only expose
// crypto.subtle on secure pages (https://, localhost, or a file opened
// directly); on a plain http:// address it is missing, so a small pure-JS
// SHA-256/HMAC (below) takes over. Both paths produce identical bytes — the
// test suite checks them against Node's crypto.
// =============================================================================

const enc = new TextEncoder();
const subtle = () => globalThis.crypto?.subtle ?? null;

// ---- pure-JS SHA-256 (FIPS 180-4) -----------------------------------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a byte array, pure JS. Returns 32 bytes. */
export function sha256Sync(bytes) {
  const len = bytes.length;
  const bitLen = len * 8;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15], w2 = W[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  H.forEach((v, i) => odv.setUint32(i * 4, v));
  return out;
}

/** HMAC-SHA256(key, message) over byte arrays, pure JS. Returns 32 bytes. */
export function hmacSha256Sync(keyBytes, msgBytes) {
  let key = keyBytes.length > 64 ? sha256Sync(keyBytes) : keyBytes;
  const k = new Uint8Array(64);
  k.set(key);
  const ipad = new Uint8Array(64 + msgBytes.length);
  const opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  ipad.set(msgBytes, 64);
  opad.set(sha256Sync(ipad), 64);
  return sha256Sync(opad);
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacBytes(serverSeed, clientSeed, nonce, cursor) {
  const keyBytes = enc.encode(serverSeed);
  const msg = enc.encode(`${clientSeed}:${nonce}:${cursor}`);
  const s = subtle();
  if (!s) return hmacSha256Sync(keyBytes, msg);
  const key = await s.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await s.sign("HMAC", key, msg));
}

/** sha256(serverSeed) as hex — the commitment shown before play. */
export async function hashServerSeed(serverSeed) {
  const s = subtle();
  const bytes = s ? new Uint8Array(await s.digest("SHA-256", enc.encode(serverSeed))) : sha256Sync(enc.encode(serverSeed));
  return toHex(bytes);
}

/** Synchronous, pure-JS commitment hash (used by the fallback and tests). */
export function hashServerSeedSync(serverSeed) {
  return toHex(sha256Sync(enc.encode(serverSeed)));
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

/** Same as floats(), but always on the pure-JS path (sync). */
export function floatsSync(serverSeed, clientSeed, nonce, count) {
  const keyBytes = enc.encode(serverSeed);
  const out = [];
  let cursor = 0;
  let buf = hmacSha256Sync(keyBytes, enc.encode(`${clientSeed}:${nonce}:${cursor}`));
  let i = 0;
  while (out.length < count) {
    if (i + 4 > buf.length) {
      cursor++;
      buf = hmacSha256Sync(keyBytes, enc.encode(`${clientSeed}:${nonce}:${cursor}`));
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
  crypto.getRandomValues(a); // available on every page, secure or not
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyCommitment(serverSeed, serverSeedHash) {
  return (await hashServerSeed(serverSeed)) === serverSeedHash;
}
