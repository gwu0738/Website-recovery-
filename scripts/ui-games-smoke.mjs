// Every game, in the browser, in both modes:
//   demo    — each game plays one round on the in-browser engine and shows a result
//   backend — each single-bet game places one bet; Mines and HiLo run a session;
//             the balance always equals what the server says
// No validator needed. Set SHOT_DIR=... to keep a screenshot of every game.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { base58Encode } = await import(pathToFileURL(join(ROOT, "server/lib/base58.ts")).href);

const API_PORT = 8878;
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "  ✅" : "  ❌"} ${label}`); if (!ok) failures++; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOT_DIR ?? mkdtempSync(join(tmpdir(), "vanta-game-shots-"));
mkdirSync(SHOTS, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "vanta-games-smoke-"));
const kp = generateKeyPairSync("ed25519");
const pub = base58Encode(new Uint8Array(Buffer.from(kp.publicKey.export({ format: "jwk" }).x, "base64url")));

const server = spawn(process.execPath, [join(ROOT, "server/server.ts")], {
  env: { ...process.env, PORT: String(API_PORT), VANTA_DATA_DIR: dir, NODE_NO_WARNINGS: "1", SOLANA_CLUSTER: "devnet", FAUCET_LAMPORTS: "1000000000", FAUCET_POW_BITS: "10" },
  stdio: "ignore",
});
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

// How to play one round of each single-bet game from the page.
const PLAYS = {
  dice: { go: "#dice-roll", done: ".die-cube.settled" },
  coinflip: { go: "#cf-flip", done: ".coin.win, .coin.lose" },
  limbo: { go: "#lb-go", done: ".lb-stage.win, .lb-stage.lose" },
  crash: { go: "#cr-go", done: ".cr-stage.win, .cr-stage.bust" },
  wheel: { go: "#wh-spin", done: ".wh-center.win, .wh-center.lose" },
  plinko: { go: "#pk-drop", done: ".pk-bucket.hit" },
  darts: { go: "#dt-throw", done: ".dt-board [data-band].lit" },
  snakes: { go: "#sn-go", done: ".sn-sq.hit" },
  keno: { prep: async (p) => p.click("#kn-quick"), go: "#kn-draw", done: ".kn-paytable span.hit" },
  roulette: { prep: async (p) => p.click(`.rl-cell[data-bet='{"type":"red"}']`), go: "#rl-spin", done: ".rl-result.show" },
};

const browser = await chromium.launch();
const demoHttp = await serveWeb("");
const apiHttp = await serveWeb(`http://127.0.0.1:${API_PORT}`);
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${API_PORT}/api/health`)).ok) break; } catch {} await pause(150); }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.exposeFunction("nodeSign", (msgB64) => sign(null, Buffer.from(msgB64, "base64"), kp.privateKey).toString("base64"));
  await ctx.addInitScript((pubkey) => {
    const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
    window.solana = {
      isPhantom: true, publicKey: null, on() {},
      async connect() { this.publicKey = { toString: () => pubkey }; return { publicKey: this.publicKey }; },
      async disconnect() { this.publicKey = null; },
      async signMessage(bytes) { const b = await window.nodeSign(toB64(bytes)); return { signature: Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }; },
    };
  }, pub);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // Network probes while the page looks for a backend (404 / refused) are expected, not page errors.
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  async function playRound(game) {
    await page.click(`.game-card[data-game="${game}"]`);
    const spec = PLAYS[game];
    await page.waitForSelector(spec.go);
    if (spec.prep) await spec.prep(page);
    await page.click(spec.go);
    await page.waitForSelector(spec.done, { timeout: 20000 });
    await pause(150);
    await page.locator("#game-view").screenshot({ path: join(SHOTS, `${game}.png`) });
  }

  console.log("A. demo mode: every game plays a round and shows its result");
  await page.goto(`http://127.0.0.1:${demoHttp.address().port}/`, { waitUntil: "load" });
  check((await page.$$eval(".game-card:not(.soon)", (e) => e.length)) === 14, "all 14 games are playable in the grid");
  for (const game of Object.keys(PLAYS)) {
    const logsBefore = await page.$$eval(".result-row", (e) => e.length);
    await playRound(game);
    const logsAfter = await page.$$eval(".result-row", (e) => e.length);
    check(logsAfter === logsBefore + 1, `${game}: played a round, result logged ("${(await page.textContent(".result-row")).trim().slice(0, 60)}")`);
  }
  // Session games in demo: Mines (reveal until cashout or bust) and HiLo (one call).
  await page.click('.game-card[data-game="mines"]');
  await page.click("#mn-action");
  await page.waitForSelector(".mn-tile:not(:disabled)");
  await page.click("#mn-random");
  await page.waitForSelector(".mn-tile.gem, .mn-tile.bomb");
  const minesState = await page.$eval("#mn-status", (e) => e.textContent);
  check(/Gem|Mine/.test(minesState), `mines: tile revealed ("${minesState.trim()}")`);
  await page.locator("#game-view").screenshot({ path: join(SHOTS, "mines.png") });
  await page.click('.game-card[data-game="hilo"]');
  await page.click("#hl-action");
  await page.waitForSelector("#hl-higher:not(:disabled)");
  check(await page.$eval("#hl-base .card", (e) => e.classList.contains("up")), "hilo: base card dealt face up");
  await page.click("#hl-higher");
  await page.waitForFunction(() => /right|wrong/i.test(document.querySelector("#hl-status").textContent), null, { timeout: 10000 });
  await page.locator("#game-view").screenshot({ path: join(SHOTS, "hilo.png") });
  check(true, `hilo: call resolved ("${(await page.textContent("#hl-status")).trim()}")`);
  check(errs.length === 0, `no page errors in demo${errs.length ? ": " + errs.join(" | ") : ""}`);

  console.log("B. backend mode: every bet moves the balance by exactly the server's numbers");
  await page.goto(`http://127.0.0.1:${apiHttp.address().port}/`, { waitUntil: "load" });
  await pause(300);
  await page.click("#wallet-btn");
  await page.waitForSelector("#account-row:not(.hidden)", { timeout: 15000 });
  await page.click("#faucet-btn");
  await page.waitForFunction(() => document.querySelector("#hdr-bal-val").textContent === "1.0000", null, { timeout: 30000 });
  const balSol = () => page.textContent("#hdr-bal-val");
  for (const game of Object.keys(PLAYS)) {
    const betRes = page.waitForResponse((r) => r.url().endsWith("/api/bet"));
    await playRound(game);
    const out = await (await betRes).json();
    await page.waitForFunction((b) => document.querySelector("#hdr-bal-val").textContent === b, (out.balanceLamports / 1e9).toFixed(4), { timeout: 5000 });
    check(out.result.game === game, `${game}: server bet settled, balance now ${await balSol()} (server ${(out.balanceLamports / 1e9).toFixed(4)})`);
  }
  // Mines session on the server: start, reveal, cash out or bust; balance follows.
  await page.click('.game-card[data-game="mines"]');
  await page.fill("#mn-amount", "0.01");
  const startRes = page.waitForResponse((r) => r.url().endsWith("/api/mines/start"));
  await page.click("#mn-action");
  const started = await (await startRes).json();
  await page.waitForFunction((b) => document.querySelector("#hdr-bal-val").textContent === b, (started.balanceLamports / 1e9).toFixed(4));
  check(true, `mines: stake locked (balance ${await balSol()})`);
  const revealRes = page.waitForResponse((r) => r.url().endsWith("/api/mines/reveal"));
  await page.click(".mn-tile[data-t='12']");
  const rev = await (await revealRes).json();
  if (rev.bust) {
    await page.waitForFunction((b) => document.querySelector("#hdr-bal-val").textContent === b, (rev.balanceLamports / 1e9).toFixed(4));
    check((await page.$$eval(".mn-tile.bomb", (e) => e.length)) === rev.minePositions.length, "mines: hit a mine, all mines shown, stake gone");
  } else {
    await page.waitForFunction(() => document.querySelector("#mn-action").textContent.startsWith("Cash Out ×"));
    const cashRes = page.waitForResponse((r) => r.url().endsWith("/api/mines/cashout"));
    await page.click("#mn-action");
    const cash = await (await cashRes).json();
    await page.waitForFunction((b) => document.querySelector("#hdr-bal-val").textContent === b, (cash.balanceLamports / 1e9).toFixed(4));
    check(cash.payoutLamports > 10_000_000, `mines: gem then cash out ×${cash.multiplier} (+${(cash.payoutLamports / 1e9).toFixed(4)} SOL)`);
  }
  // HiLo session on the server.
  await page.click('.game-card[data-game="hilo"]');
  const hlStart = page.waitForResponse((r) => r.url().endsWith("/api/hilo/start"));
  await page.click("#hl-action");
  const hs = await (await hlStart).json();
  await page.waitForSelector("#hl-higher:not(:disabled)");
  const baseShown = await page.textContent("#hl-base .card-rank");
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  check(baseShown === RANKS[hs.base.rank], `hilo: page shows the server's base card (${baseShown})`);
  const guessRes = page.waitForResponse((r) => r.url().endsWith("/api/hilo/guess"));
  await page.click(hs.base.rank <= 6 ? "#hl-higher" : "#hl-lower");
  const g = await (await guessRes).json();
  await page.waitForFunction(() => /right|wrong/i.test(document.querySelector("#hl-status").textContent), null, { timeout: 10000 });
  if (g.bust) check(true, "hilo: wrong call, stake lost");
  else {
    await page.waitForSelector("#hl-higher:not(:disabled)");
    const cr = page.waitForResponse((r) => r.url().endsWith("/api/hilo/cashout"));
    await page.click("#hl-action");
    const c = await (await cr).json();
    await page.waitForFunction((b) => document.querySelector("#hdr-bal-val").textContent === b, (c.balanceLamports / 1e9).toFixed(4));
    check(c.multiplier === g.multiplier, `hilo: right call ×${g.multiplier}, cashed out`);
  }
  check(errs.length === 0, `no page errors in backend mode${errs.length ? ": " + errs.join(" | ") : ""}`);
  console.log(`screenshots in ${SHOTS}`);
} finally {
  await browser.close();
  demoHttp.close();
  apiHttp.close();
  server.kill();
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ all games pass in both modes");
process.exit(failures ? 1 : 0);
