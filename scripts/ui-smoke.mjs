// Browser smoke test that needs no Solana validator: the real page against the
// real backend (faucet credit instead of SOL), with a stand-in Phantom.
//
//   node scripts/ui-smoke.mjs            (set SHOT_DIR=... to keep screenshots)
//
// Checks: demo roulette spin; backend sign-in, faucet, a roulette table bet that
// moves the balance by exactly the server's numbers; the balance surviving a page
// reload AND a server restart; an unfinished Tower game surviving a reload
// (resume banner → resume → cash out); sign-out/sign-in keeping the balance.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { base58Encode } = await import(join(ROOT, "server/lib/base58.ts"));

const API_PORT = 8877;
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "  ✅" : "  ❌"} ${label}`); if (!ok) failures++; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOT_DIR ?? mkdtempSync(join(tmpdir(), "vanta-shots-"));
mkdirSync(SHOTS, { recursive: true });

const dir = mkdtempSync(join(tmpdir(), "vanta-ui-smoke-"));
const kp = generateKeyPairSync("ed25519");
const jwk = kp.publicKey.export({ format: "jwk" });
const pub = base58Encode(new Uint8Array(Buffer.from(jwk.x, "base64url")));

let server = null;
function startServer() {
  server = spawn(process.execPath, [join(ROOT, "server/server.ts")], {
    env: { ...process.env, PORT: String(API_PORT), VANTA_DATA_DIR: dir, NODE_NO_WARNINGS: "1", SOLANA_CLUSTER: "devnet" },
    stdio: "ignore",
  });
}
async function waitHealthy() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${API_PORT}/api/health`)).ok) return; } catch {} await pause(150); }
  throw new Error("server didn't come up");
}

// Static copies of web/: one in demo mode, one pointed at the API.
function serveWeb(apiBase) {
  const web = join(dir, apiBase ? "web-backend" : "web-demo");
  cpSync(join(ROOT, "web"), web, { recursive: true });
  if (apiBase) {
    const cfgPath = join(web, "js/config.js");
    writeFileSync(cfgPath, readFileSync(cfgPath, "utf8").replace('export const API_BASE = "";', `export const API_BASE = "${apiBase}";`));
  }
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
  const http = createServer((req, res) => {
    let p = req.url.split("?")[0];
    if (p === "/") p = "/index.html";
    const f = join(web, p);
    if (!f.startsWith(web) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": MIME[extname(f)] || "text/plain" });
    res.end(readFileSync(f));
  });
  return new Promise((r) => http.listen(0, () => r(http)));
}

const browser = await chromium.launch();
const demoHttp = await serveWeb("");
const apiHttp = await serveWeb(`http://127.0.0.1:${API_PORT}`);
startServer();
try {
  await waitHealthy();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.exposeFunction("nodeSign", (msgB64) => sign(null, Buffer.from(msgB64, "base64"), kp.privateKey).toString("base64"));
  await ctx.addInitScript((pubkey) => {
    const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
    const listeners = {};
    window.solana = {
      isPhantom: true,
      publicKey: null,
      on(ev, fn) { (listeners[ev] ??= []).push(fn); },
      async connect() { this.publicKey = { toString: () => pubkey }; return { publicKey: this.publicKey }; },
      async disconnect() { this.publicKey = null; },
      async signMessage(bytes) {
        const sigB64 = await window.nodeSign(toB64(bytes));
        return { signature: Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0)) };
      },
    };
  }, pub);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

  console.log("A. demo mode: roulette spins and settles in-browser");
  await page.goto(`http://127.0.0.1:${demoHttp.address().port}/`, { waitUntil: "load" });
  await page.click('.game-card[data-game="roulette"]');
  await page.waitForSelector(".rl-table");
  check((await page.$$eval(".rl-cell", (e) => e.length)) === 37 + 3 + 3 + 6, "table has 37 numbers + 3 columns + 3 dozens + 6 even-money spots");
  check((await page.$$eval(".rl-wheel-svg [data-pocket]", (e) => e.length)) === 37, "wheel has 37 pockets");
  await page.fill("#rl-chip", "1");
  await page.click('.rl-cell[data-bet=\'{"type":"red"}\']');
  await page.click('.rl-cell[data-bet=\'{"type":"straight","number":17}\']');
  await page.click('.rl-cell[data-bet=\'{"type":"straight","number":17}\']');
  check((await page.textContent("#rl-total")).trim() === "3", "two spots, three chips → total 3");
  await page.click("#rl-undo");
  check((await page.textContent("#rl-total")).trim() === "2", "undo removes the last chip");
  const rotBefore = await page.$eval("#rl-rotor", (e) => e.style.transform);
  await page.click("#rl-spin");
  await pause(1500);
  const rotMid = await page.$eval("#rl-rotor", (e) => e.style.transform);
  check(rotBefore !== rotMid, "the wheel is actually turning mid-spin");
  await page.screenshot({ path: join(SHOTS, "roulette-spinning.png"), clip: await page.$eval(".bet-panel", (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 900) }; }) });
  await page.waitForSelector(".rl-result.show", { timeout: 15000 });
  const num = Number(await page.textContent(".rl-result-num"));
  check(Number.isInteger(num) && num >= 0 && num <= 36, `ball landed on ${num}`);
  const hit = await page.$eval(".rl-cell.hit", (e) => JSON.parse(e.dataset.bet).number);
  check(hit === num, "the winning number is highlighted on the table");
  check((await page.$$eval(".rl-hist-chip", (e) => e.length)) === 1, "result added to the history strip");
  const log = (await page.textContent(".result-row")).trim();
  check(/Roulette \d+ (red|black|green)/.test(log), `log: "${log}"`);
  // Landing geometry: the pocket under the top pointer must be the result.
  const landed = await page.evaluate(() => {
    const rotor = document.querySelector("#rl-rotor");
    const deg = parseFloat(rotor.style.transform.replace(/[^-\d.]/g, ""));
    const order = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
    const step = 360 / 37;
    const under = ((360 - (((deg % 360) + 360) % 360)) % 360) / step; // pocket index at the pointer
    return order[Math.floor(under)];
  });
  check(landed === num, `pocket under the pointer (${landed}) is the result`);
  await page.locator(".bet-panel").screenshot({ path: join(SHOTS, "roulette-result.png") });

  console.log("B. backend mode: sign in, faucet, roulette moves the balance by the server's numbers");
  await page.goto(`http://127.0.0.1:${apiHttp.address().port}/`, { waitUntil: "load" });
  await pause(300);
  await page.click("#wallet-btn");
  await page.waitForSelector("#account-row:not(.hidden)", { timeout: 15000 });
  await page.click("#faucet-btn");
  await page.waitForFunction(() => document.querySelector("#balance-val").textContent !== "0.0000" && document.querySelector("#balance-val").textContent !== "—");
  const bal0 = await page.textContent("#balance-val");
  check(bal0 === "0.0500", `faucet credited: balance ${bal0} SOL`);
  await page.click('.game-card[data-game="roulette"]');
  await page.waitForSelector(".rl-table");
  await page.fill("#rl-chip", "0.001");
  await page.click('.rl-cell[data-bet=\'{"type":"black"}\']');
  await page.click('.rl-cell[data-bet=\'{"type":"dozen","dozen":1}\']');
  await page.click('.rl-cell[data-bet=\'{"type":"straight","number":0}\']');
  const betReq = page.waitForResponse((r) => r.url().endsWith("/api/bet"));
  await page.click("#rl-spin");
  const betRes = await (await betReq).json();
  check(betRes.stakeLamports === 3_000_000, `server received one bet with stake = 3 chips (${betRes.stakeLamports})`);
  check((await page.textContent("#balance-val")) === bal0, "balance display waits for the ball to land (no spoiler)");
  await page.waitForSelector(".rl-result.show", { timeout: 15000 });
  const bal1 = await page.textContent("#balance-val");
  check(bal1 === (betRes.balanceLamports / 1e9).toFixed(4), `balance after spin ${bal1} = server's ${(betRes.balanceLamports / 1e9).toFixed(4)}`);
  check(Number(await page.textContent(".rl-result-num")) === betRes.result.outcome.pocket, "wheel shows the server's pocket");
  await page.locator(".bet-panel").screenshot({ path: join(SHOTS, "roulette-backend.png") });

  console.log("C. the balance survives a reload, a server restart, and sign-out/sign-in");
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#account-row:not(.hidden)", { timeout: 15000 });
  await page.waitForFunction((b) => document.querySelector("#balance-val").textContent === b, bal1);
  check(true, `after reload still signed in with ${bal1} SOL`);
  server.kill();
  await pause(300);
  startServer();
  await waitHealthy();
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#account-row:not(.hidden)", { timeout: 15000 });
  await page.waitForFunction((b) => document.querySelector("#balance-val").textContent === b, bal1);
  check(true, `after a server restart still signed in with ${bal1} SOL (sessions persisted)`);
  await page.click("#wallet-btn"); // disconnect
  await page.waitForSelector("#account-row.hidden", { state: "attached" });
  await page.click("#wallet-btn"); // reconnect + sign in again
  await page.waitForSelector("#account-row:not(.hidden)", { timeout: 15000 });
  await page.waitForFunction((b) => document.querySelector("#balance-val").textContent === b, bal1);
  check(true, `sign out → sign in: same ${bal1} SOL`);

  console.log("D. an unfinished Tower game (locked stake) survives a reload");
  await page.click('.game-card[data-game="tower"]');
  await page.waitForSelector("#tw-action");
  await page.fill("#tw-amount", "0.005");
  await page.click("#tw-action");
  await page.waitForSelector(".tower-row.active");
  const balLocked = await page.textContent("#balance-val");
  check(Number(balLocked) === Math.round((Number(bal1) - 0.005) * 1e4) / 1e4, `stake locked: ${balLocked} SOL`);
  // Climb one row with a tile the layout says is safe (read via the API like a verifier would).
  const auth = await page.evaluate(() => localStorage.getItem("vanta_token"));
  const active = await (await fetch(`http://127.0.0.1:${API_PORT}/api/sessions/active`, { headers: { authorization: `Bearer ${auth}` } })).json();
  check(active.sessions.length === 1 && active.sessions[0].progress.rowsClimbed === 0, "server lists the unfinished game");
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#resume-banner:not(.hidden)", { timeout: 15000 });
  const bannerText = (await page.textContent("#resume-banner")).replace(/\s+/g, " ").trim();
  check(/unfinished Tower game .* 0\.0050 SOL staked/.test(bannerText), `banner: "${bannerText}"`);
  check((await page.$("#resume-cashout")) === null, "no cash-out offered before the first move (server rule)");
  await page.click("#resume-go");
  await page.waitForSelector(".tower-row.active");
  check((await page.textContent("#tw-action")).startsWith("Cash Out"), "resumed game is live: button says Cash Out");
  // Pick tiles until one is safe or we bust (easy/medium → mostly safe).
  let outcome = null;
  for (let c = 0; c < 4 && !outcome; c++) {
    const res = page.waitForResponse((r) => r.url().endsWith("/api/tower/reveal"));
    await page.click(`.tower-row.active .tower-tile[data-col="${c}"]`);
    const r = await (await res).json();
    outcome = r.bust ? "bust" : "safe";
  }
  if (outcome === "safe") {
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#resume-banner:not(.hidden)", { timeout: 15000 });
    await page.waitForSelector("#resume-cashout");
    const cash = page.waitForResponse((r) => r.url().endsWith("/api/tower/cashout"));
    await page.click("#resume-cashout");
    const c = await (await cash).json();
    await page.waitForFunction((b) => document.querySelector("#balance-val").textContent === b, (c.balanceLamports / 1e9).toFixed(4));
    check(c.payoutLamports > 5_000_000, `cashed out from the banner: +${(c.payoutLamports / 1e9).toFixed(4)} SOL`);
    await page.waitForSelector("#resume-banner.hidden", { state: "attached" });
    check(true, "banner gone once the game is settled");
  } else {
    check(true, "busted on the first row (loss recorded; nothing left to resume)");
  }
  await page.locator(".bet-panel").screenshot({ path: join(SHOTS, "tower-resumed.png") });
  check(errs.length === 0, `no page errors${errs.length ? ": " + errs.join(" | ") : ""}`);
  console.log(`screenshots in ${SHOTS}`);
} finally {
  await browser.close();
  demoHttp.close();
  apiHttp.close();
  server?.kill();
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ UI smoke passed");
process.exit(failures ? 1 : 0);
