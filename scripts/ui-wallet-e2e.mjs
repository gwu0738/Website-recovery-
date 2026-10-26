// Browser end-to-end for real SOL: the actual page builds the deposit
// transaction, a stand-in for Phantom signs it (throwaway key, Node side) and
// sends it to the chain, the server verifies + credits it, then a withdrawal
// pays out on-chain. Needs a local validator (solana-test-validator) on :8899.
//
//   node scripts/ui-wallet-e2e.mjs
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RPC = "http://127.0.0.1:8899";
const API_PORT = 8866;
const conn = new Connection(RPC, "confirmed");
const SOL = LAMPORTS_PER_SOL;
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "  ✅" : "  ❌"} ${label}`); if (!ok) failures++; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function airdrop(pk, sol) {
  const sig = await conn.requestAirdrop(pk, sol * SOL);
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, "confirmed");
}

const dir = mkdtempSync(join(tmpdir(), "vanta-ui-e2e-"));
const house = Keypair.generate();
const player = Keypair.generate();
writeFileSync(join(dir, "house.keypair.json"), JSON.stringify([...house.secretKey]));
await airdrop(house.publicKey, 5);
await airdrop(player.publicKey, 2);

const server = spawn(process.execPath, [join(ROOT, "server/server.ts")], {
  env: { ...process.env, PORT: String(API_PORT), VANTA_DATA_DIR: dir, NODE_NO_WARNINGS: "1",
    SOLANA_CLUSTER: "localnet", SOLANA_RPC_URL: RPC, HOUSE_KEYPAIR_FILE: join(dir, "house.keypair.json") },
  stdio: "ignore",
});

// Serve a copy of web/ pointed at the API.
const web = join(dir, "web");
cpSync(join(ROOT, "web"), web, { recursive: true });
const cfgPath = join(web, "js/config.js");
writeFileSync(cfgPath, readFileSync(cfgPath, "utf8").replace('export const API_BASE = "";', `export const API_BASE = "http://127.0.0.1:${API_PORT}";`));
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const http = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const f = join(web, p);
  if (!f.startsWith(web) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "text/plain" });
  res.end(readFileSync(f));
});
await new Promise((r) => http.listen(0, r));

const browser = await chromium.launch();
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${API_PORT}/api/health`)).ok) break; } catch {} await pause(200); }

  const ctx = await browser.newContext();
  // Serve the pinned Solana bundle locally instead of from the CDN (same file).
  await ctx.route("**/@solana/web3.js@1.95.3/lib/index.iife.min.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync(join(ROOT, "node_modules/@solana/web3.js/lib/index.iife.min.js")) }));
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const key = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: b64u(player.secretKey.slice(0, 32)), x: b64u(player.publicKey.toBytes()) }, format: "jwk" });
  await ctx.exposeFunction("nodeSign", (msgB64) => sign(null, Buffer.from(msgB64, "base64"), key).toString("base64"));
  await ctx.exposeFunction("nodeSignAndSend", async (txB64) => {
    const tx = Transaction.from(Buffer.from(txB64, "base64"));
    tx.partialSign(player);
    return conn.sendRawTransaction(tx.serialize());
  });
  await ctx.addInitScript((pub) => {
    const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
    window.solana = {
      isPhantom: true,
      async connect() { return { publicKey: { toString: () => pub } }; },
      async disconnect() {},
      async signMessage(bytes) {
        const sigB64 = await window.nodeSign(toB64(bytes)); // raw 64-byte ed25519 signature, like Phantom
        return { signature: Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0)) };
      },
      async signAndSendTransaction(tx) {
        const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        return { signature: await window.nodeSignAndSend(toB64(raw)) };
      },
    };
  }, player.publicKey.toBase58());

  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${http.address().port}/`, { waitUntil: "load" });
  await pause(500);

  console.log("1. sign in + open wallet");
  await page.click("#wallet-btn");
  await page.waitForSelector("#account-row:not(.hidden)", { timeout: 15000 });
  await page.click("#wallet-open");
  await page.waitForFunction((h) => document.querySelector("#wp-house")?.textContent === h, house.publicKey.toBase58(), { timeout: 15000 });
  check(true, "wallet panel shows the house deposit address");
  check((await page.textContent("#cluster-badge")).trim() === "localnet", "cluster badge follows the server (localnet)");
  check(/^Real SOL on localnet/.test((await page.textContent("#mode-note")).trim()), "page states real SOL is in play (not 'demo')");
  await pause(4000);
  check((await page.$$eval(".chat-msg", (e) => e.length)) === 0, "no simulated players in the chat with real money on");

  console.log("2. deposit 0.3 SOL from the page");
  const before = await conn.getBalance(player.publicKey, "confirmed");
  await page.fill("#wp-dep", "0.3");
  await page.click("#wp-dep-form button[type=submit]");
  await page.waitForFunction(() => /Deposited|failed|Error|not/i.test(document.querySelector("#wp-status")?.textContent || ""), null, { timeout: 60000 });
  const depStatus = (await page.textContent("#wp-status")).trim();
  check(/Deposited 0\.3/.test(depStatus), `page says: "${depStatus}"`);
  check((await page.textContent("#balance-val")).trim() === "0.3000", `site balance ${await page.textContent("#balance-val")} SOL`);
  const after = await conn.getBalance(player.publicKey, "confirmed");
  check(before - after >= 0.3 * SOL && before - after < 0.3 * SOL + 100_000, `player wallet −${((before - after) / SOL).toFixed(6)} SOL on-chain (0.3 + fee)`);

  console.log("3. withdraw 0.1 SOL from the page");
  const pBefore = await conn.getBalance(player.publicKey, "confirmed");
  await page.fill("#wp-wd", "0.1");
  await page.click("#wp-wd-form button[type=submit]");
  await page.waitForFunction(() => /Withdrew|pending|failed|Insufficient|wager|can't/i.test(document.querySelector("#wp-status")?.textContent || ""), null, { timeout: 60000 });
  const wdStatus = (await page.textContent("#wp-status")).trim();
  check(/Withdrew 0\.1/.test(wdStatus), `page says: "${wdStatus}"`);
  const pAfter = await conn.getBalance(player.publicKey, "confirmed");
  check(pAfter - pBefore === 0.1 * SOL, `player wallet +${((pAfter - pBefore) / SOL).toFixed(6)} SOL on-chain`);
  check((await page.textContent("#balance-val")).trim() === "0.2000", `site balance ${await page.textContent("#balance-val")} SOL`);
  const items = await page.$$eval("#wp-list li", (els) => els.map((e) => e.textContent.trim()));
  check(items.length === 2, `history: ${JSON.stringify(items)}`);
  check(errs.length === 0, `no page errors${errs.length ? ": " + errs.join(" | ") : ""}`);

  await page.locator(".bet-panel").screenshot({ path: join(process.env.SHOT_DIR ?? dir, "wallet-panel.png") });
  console.log(`screenshot: ${join(process.env.SHOT_DIR ?? dir, "wallet-panel.png")}`);
} finally {
  await browser.close();
  http.close();
  server.kill();
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ browser real-SOL flow passed");
process.exit(failures ? 1 : 0);
