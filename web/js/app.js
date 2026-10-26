// =============================================================================
// App bootstrap — branding, the games grid, every game's wiring to the engine,
// wallet sign-in, balance, faucet, the live feed, and chat.
//
// Two ways to run, decided at startup by looking for the backend:
//   - server found: real accounts, balances, deposits, withdrawals, server bets
//   - no server:    the same games on the in-browser engine; the balance lives
//                   in this browser only
// =============================================================================
import { BRAND, SOCIALS, HOUSE_EDGE, TURNSTILE_SITE_KEY, toSol, setActiveCluster } from "./config.js";
import { randomHex, hashServerSeed, verifyCommitment, floats, sha256Sync } from "./fairness.js";
import {
  playDice, playLimbo, playCrash, playCoinflip, playWheel, playPlinko, playDarts, playSnakes, playKeno,
  minesLayout, minesMultiplier, HILO_RANKS, GAME_CATALOG,
} from "./games.js";
import { roulettePocket, rouletteSettle, pocketColor } from "./roulette-logic.js";
import { api, isBackend, detectBackend } from "./api.js";
import { listWallets, connectWallet, restoreWallet, disconnectWallet, getProvider } from "./wallets.js";
import { createWalletPanel } from "./wallet-panel.js";
import { setBetLimits } from "./bet-field.js";
import { localBalance, setLocalBalance } from "./local-bank.js";
import { createFeed } from "./feed.js";
import { createDiceGame } from "./dice-game.js";
import { createTowerGame } from "./tower-game.js";
import { towerLayout, towerMultiplier, TOWER_ROWS } from "./tower-logic.js";
import { createChickenGame } from "./chicken-game.js";
import { chickenDeathPoint, chickenMultiplier, chickenMaxSteps } from "./chicken-logic.js";
import { createRouletteGame } from "./roulette-game.js";
import { createCoinflipGame } from "./coinflip-game.js";
import { createLimboGame } from "./limbo-game.js";
import { createCrashGame } from "./crash-game.js";
import { createWheelGame } from "./wheel-game.js";
import { createPlinkoGame } from "./plinko-game.js";
import { createHiLoGame } from "./hilo-game.js";
import { createDartsGame } from "./darts-game.js";
import { createSnakesGame } from "./snakes-game.js";
import { createKenoGame } from "./keno-game.js";
import { createMinesGame } from "./mines-game.js";
import { Chat } from "./chat.js";

const $ = (sel) => document.querySelector(sel);
const SOL = 1_000_000_000;
const round9 = (x) => Math.round(x * 1e9) / 1e9;

let account = null; // signed-in account (server mode)
let connected = null; // connected wallet address
let serverCfg = null; // /api/config
let walletPanel = null;
let feed = null;

// ---- Branding + socials -----------------------------------------------------
document.title = BRAND.name;
$("#brand-name").textContent = BRAND.name;
$("#brand-tag").textContent = BRAND.tagline;
$("#footer-brand").textContent = BRAND.name;
$("#footer-brand2").textContent = BRAND.name;
$("#year").textContent = new Date().getFullYear();
$("#edge-label").textContent = (HOUSE_EDGE * 100).toFixed(1) + "%";
for (const [key, url] of Object.entries(SOCIALS)) {
  if (!url) continue;
  document.querySelectorAll(`[data-social="${key}"]`).forEach((el) => {
    el.href = url;
    el.classList.remove("hidden");
  });
}

// ---- Balance (header) -------------------------------------------------------
function showBalance(sol) {
  $("#hdr-balance").classList.remove("hidden");
  $("#hdr-bal-val").textContent = Number(sol).toFixed(4);
  const maxStake = serverCfg ? serverCfg.maxStakeLamports / SOL : null;
  setBetLimits({ max: maxStake != null ? Math.min(sol, maxStake) : sol, min: serverCfg ? serverCfg.minStakeLamports / SOL : 0.001 });
}
function updateBalance(lamports) {
  showBalance(lamports / SOL);
}
function bank() {
  return localBalance();
}
function bankSet(v) {
  const b = setLocalBalance(v);
  showBalance(b);
  return b;
}

// ---- Wallet connect / sign-in ----------------------------------------------
const walletBtn = $("#wallet-btn");
const walletInfo = $("#wallet-info");
const modal = $("#wallet-modal");
const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

function openWalletPicker(wallets) {
  const list = $("#wallet-list");
  list.innerHTML = wallets.map((w) =>
    `<button class="wallet-opt" data-id="${w.id}">${w.icon ? `<img src="${w.icon}" alt="">` : `<span class="wallet-ico">◎</span>`}${w.name}</button>`).join("");
  list.querySelectorAll(".wallet-opt").forEach((b) =>
    b.addEventListener("click", () => { modal.classList.add("hidden"); connectAndSignIn(b.dataset.id); }));
  modal.classList.remove("hidden");
}
$("#wallet-modal-close").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

walletBtn.addEventListener("click", async () => {
  if (connected) {
    await signOut();
    return;
  }
  const wallets = listWallets();
  if (!wallets.length) {
    walletInfo.textContent = "No wallet found — install Phantom, Solflare or Backpack";
    return;
  }
  if (wallets.length === 1) connectAndSignIn(wallets[0].id);
  else openWalletPicker(wallets);
});

async function connectAndSignIn(walletId) {
  try {
    const provider = await connectWallet(walletId);
    connected = provider.address;
    walletBtn.textContent = short(connected);
    provider.onAccountChanged(onAccountChanged);
    if (isBackend()) {
      walletInfo.textContent = "signing in…";
      account = await api.signIn(provider, connected);
      await afterSignIn();
    } else {
      walletInfo.textContent = `${provider.name} connected`;
    }
  } catch (e) {
    walletInfo.textContent = e.message || "connection failed";
    if (!account) { connected = null; walletBtn.textContent = "Connect Wallet"; }
  }
}

// The wallet switched accounts: a deposit from the new one would never be
// credited to the old sign-in, so follow the switch.
async function onAccountChanged(next) {
  if (!connected || next === connected) return;
  await signOut();
  walletInfo.textContent = next ? "Wallet switched accounts — connect again to sign in with it" : "Wallet disconnected";
}

async function signOut() {
  if (isBackend() && api.hasToken()) {
    try { await api.logout(); } catch { /* token may already be gone */ }
  }
  await disconnectWallet();
  connected = null;
  account = null;
  api.clearToken();
  walletBtn.textContent = "Connect Wallet";
  walletInfo.textContent = "";
  $("#account-row").classList.add("hidden");
  $("#wallet-panel").classList.add("hidden");
  $("#wallet-open").setAttribute("aria-expanded", "false");
  $("#resume-banner").classList.add("hidden");
  $("#hdr-deposit").classList.add("hidden");
  if (isBackend()) $("#hdr-balance").classList.add("hidden");
  setModeNote();
  await refreshSeeds();
}

async function afterSignIn() {
  $("#account-row").classList.remove("hidden");
  $("#hdr-deposit").classList.remove("hidden");
  walletBtn.textContent = short(account.pubkey);
  walletInfo.textContent = "signed in";
  updateBalance(account.balanceLamports);
  setModeNote();
  walletPanel = createWalletPanel($("#wallet-panel"), {
    getProvider,
    getAddress: () => connected ?? account?.pubkey,
    onBalance: updateBalance,
    log: logResult,
  });
  await refreshSeeds();
  await showUnfinishedGames();
  feed?.start();
}

function setModeNote() {
  const note = $("#mode-note");
  if (!isBackend()) {
    note.textContent = "No server connected — this balance lives in your browser only. Every result still comes from a committed seed you can verify below. 18+.";
  } else if (account) {
    note.textContent = "Playing for real SOL: every bet moves your balance, and deposits and withdrawals are on-chain transactions. 18+. Only play with what you can afford to lose.";
  } else {
    note.textContent = "Connect a wallet to play. Every result comes from a seed committed before you bet — verify any round below. 18+.";
  }
}

function openWalletPanel() {
  const panel = $("#wallet-panel");
  panel.classList.remove("hidden");
  $("#wallet-open").setAttribute("aria-expanded", "true");
  walletPanel?.refresh();
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
}
$("#wallet-open").addEventListener("click", () => {
  const panel = $("#wallet-panel");
  const opening = panel.classList.contains("hidden");
  if (opening) openWalletPanel();
  else {
    panel.classList.add("hidden");
    $("#wallet-open").setAttribute("aria-expanded", "false");
  }
});
$("#hdr-deposit").addEventListener("click", openWalletPanel);

// ---- Faucet (with the anti-bot gate) ----------------------------------------
function leadingZeroBits(hash) {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}
async function solveProof(challenge, bits) {
  const enc = new TextEncoder();
  for (let n = 0; ; ) {
    for (let i = 0; i < 2500; i++, n++) {
      if (leadingZeroBits(sha256Sync(enc.encode(`${challenge}:${n}`))) >= bits) return String(n);
    }
    await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
}
let turnstileLoaded = null;
function turnstileToken(container) {
  turnstileLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the captcha"));
    document.head.appendChild(s);
  });
  return turnstileLoaded.then(() => new Promise((resolve, reject) => {
    container.innerHTML = "";
    window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => { container.innerHTML = ""; resolve(token); },
      "error-callback": () => reject(new Error("Captcha failed — try again")),
    });
  }));
}
$("#faucet-btn").addEventListener("click", async () => {
  if (!account) return;
  const btn = $("#faucet-btn");
  const status = $("#faucet-status");
  btn.disabled = true;
  try {
    const ch = await api.faucetChallenge();
    let proof = {};
    if (ch.turnstile) {
      status.textContent = "";
      proof = { captcha: await turnstileToken(status) };
    } else if (ch.difficulty > 0) {
      status.textContent = "Checking you're human…";
      proof = { nonce: await solveProof(ch.challenge, ch.difficulty) };
    }
    const r = await api.faucet(proof);
    updateBalance(r.balanceLamports);
    status.textContent = `+${toSol(r.creditedLamports)} SOL credited`;
    logResult(`🚰 Faucet credited +${toSol(r.creditedLamports)} SOL`);
  } catch (e) {
    status.textContent = e.message;
    logResult("faucet: " + e.message);
  } finally {
    btn.disabled = false;
  }
});

// ---- Unfinished games (locked stakes) ---------------------------------------
async function showUnfinishedGames() {
  const banner = $("#resume-banner");
  banner.classList.add("hidden");
  if (!isBackend() || !account) return;
  let sessions = [];
  try {
    sessions = (await api.sessionsActive()).sessions.filter((s) => s.progress && RICH_GAMES.has(s.game));
  } catch {
    return;
  }
  if (!sessions.length) return;
  const s = sessions[0];
  const name = GAME_CATALOG.find((g) => g.id === s.game)?.name ?? s.game;
  const p = s.progress;
  const progress = { tower: p.rowsClimbed, chicken: p.stepsTaken, mines: p.revealed?.length, hilo: p.correct }[s.game] ?? 0;
  const unit = { tower: "row|rows climbed", chicken: "lane|lanes crossed", mines: "gem|gems found", hilo: "right call|right calls" }[s.game];
  const [one, many] = unit.split("|");
  banner.innerHTML =
    `<span class="grow">You have an unfinished <strong>${name}</strong> game${p.difficulty ? ` (${p.difficulty})` : p.mines ? ` (${p.mines} mines)` : ""} with ` +
    `<strong>${toSol(s.stakeLamports)} SOL</strong> staked · ${progress} ${progress === 1 ? one : many} · x${p.multiplier}` +
    (sessions.length > 1 ? ` (+${sessions.length - 1} more)` : "") + `</span>` +
    `<button class="btn btn-primary" id="resume-go">Resume</button>` +
    (progress > 0 ? `<button class="btn btn-ghost" id="resume-cashout">Cash out x${p.multiplier}</button>` : "");
  banner.classList.remove("hidden");
  banner.querySelector("#resume-go").addEventListener("click", () => {
    selectGame(s.game);
    currentGameUi?.restore?.({ sessionId: s.sessionId, ...p });
    banner.classList.add("hidden");
    $("#game-view").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  banner.querySelector("#resume-cashout")?.addEventListener("click", async () => {
    try {
      const r = await api[s.game].cashout(s.sessionId);
      updateBalance(r.balanceLamports);
      logResult(`💰 ${name} cashed out x${r.multiplier} (+${toSol(r.payoutLamports)} SOL)`);
    } catch (e) {
      logResult("error: " + e.message);
    }
    await showUnfinishedGames();
  });
}

// ---- Games grid -------------------------------------------------------------
const grid = $("#games-grid");
for (const g of GAME_CATALOG) {
  const card = document.createElement("button");
  card.className = "game-card";
  card.dataset.game = g.id;
  card.innerHTML = `<span class="game-ico-wrap">${g.icon ?? ""}</span><span class="game-name">${g.name}</span><span class="game-blurb">${g.blurb}</span>`;
  card.addEventListener("click", () => {
    selectGame(g.id);
    $("#game-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  grid.appendChild(card);
}

// ---- Seeds (no-server mode keeps its own pair; server mode shows the account's)
let serverSeed = randomHex(32);
let clientSeed = randomHex(8);
let nonce = 1;
let currentGame = "dice";

async function refreshSeeds() {
  if (isBackend() && account) {
    $("#seed-hash").textContent = account.serverSeedHash;
    $("#seed-client").textContent = account.clientSeed;
    $("#seed-nonce").textContent = account.nonce;
    return;
  }
  $("#seed-hash").textContent = await hashServerSeed(serverSeed);
  $("#seed-client").textContent = clientSeed;
  $("#seed-nonce").textContent = nonce;
}
$("#new-seed").addEventListener("click", async () => {
  if (isBackend() && account) {
    try {
      const r = await api.rotateSeed();
      account = (await api.me()).account;
      await refreshSeeds();
      logResult(`↻ Seed rotated. Revealed: ${r.revealedServerSeed.slice(0, 16)}…`);
    } catch (e) {
      logResult("error: " + e.message);
    }
    return;
  }
  serverSeed = randomHex(32);
  clientSeed = randomHex(8);
  nonce = 1;
  await refreshSeeds();
  logResult("↻ New seed pair generated. The old server seed is now revealable.");
});

// ---- Mounting games ---------------------------------------------------------
const RICH_GAMES = new Set(GAME_CATALOG.map((g) => g.id));
let currentGameUi = null;

function mountGame(id) {
  const view = $("#game-view");
  view.innerHTML = "";
  const amountLabel = "Bet (SOL)";
  currentGameUi = null;
  if (id === "dice") currentGameUi = createDiceGame(view, { onRoll: diceOnRoll, amountLabel });
  else if (id === "coinflip") currentGameUi = createCoinflipGame(view, { onPlay: singleBet("coinflip", playCoinflip), amountLabel });
  else if (id === "limbo") currentGameUi = createLimboGame(view, { onPlay: singleBet("limbo", playLimbo), amountLabel });
  else if (id === "crash") currentGameUi = createCrashGame(view, { onPlay: singleBet("crash", playCrash), amountLabel });
  else if (id === "wheel") currentGameUi = createWheelGame(view, { onPlay: singleBet("wheel", playWheel), amountLabel });
  else if (id === "plinko") currentGameUi = createPlinkoGame(view, { onPlay: singleBet("plinko", playPlinko), amountLabel });
  else if (id === "darts") currentGameUi = createDartsGame(view, { onPlay: singleBet("darts", playDarts), amountLabel });
  else if (id === "snakes") currentGameUi = createSnakesGame(view, { onPlay: singleBet("snakes", playSnakes), amountLabel });
  else if (id === "keno") currentGameUi = createKenoGame(view, { onPlay: singleBet("keno", playKeno), amountLabel });
  else if (id === "roulette") currentGameUi = createRouletteGame(view, { onSpin: rouletteOnSpin, amountLabel });
  else if (id === "mines") currentGameUi = createMinesGame(view, { onStart: minesOnStart, onReveal: minesOnReveal, onCashout: minesOnCashout, amountLabel });
  else if (id === "hilo") currentGameUi = createHiLoGame(view, { onStart: hiloOnStart, onGuess: hiloOnGuess, onCashout: hiloOnCashout, amountLabel });
  else if (id === "tower") currentGameUi = createTowerGame(view, { onStart: towerOnStart, onReveal: towerOnReveal, onCashout: towerOnCashout, amountLabel });
  else if (id === "chicken") currentGameUi = createChickenGame(view, { onStart: chickenOnStart, onStep: chickenOnStep, onCashout: chickenOnCashout, amountLabel });
}
function selectGame(id) {
  currentGame = id;
  grid.querySelectorAll(".game-card").forEach((c) => c.classList.toggle("active", c.dataset.game === id));
  $("#panel-title").textContent = GAME_CATALOG.find((g) => g.id === id).name;
  mountGame(id);
}

// ---- Result log + feed ------------------------------------------------------
function logResult(line) {
  const log = $("#result-log");
  const row = document.createElement("div");
  row.className = "result-row";
  row.textContent = line;
  log.prepend(row);
  while (log.children.length > 12) log.removeChild(log.lastChild);
}
function describeOutcome(r) {
  const o = r.outcome;
  switch (r.game) {
    case "dice": return `🎲 Dice rolled ${o.roll} (${o.direction} ${o.target})`;
    case "limbo": return `🚀 Limbo ${o.result}× (target ${o.target}×)`;
    case "crash": return `📈 Crash busted at ${o.bustAt}× (cash-out ${o.cashOut}×)`;
    case "coinflip": return `🪙 Coin: ${o.flip} (called ${o.call})`;
    case "wheel": return `🎡 Wheel: ${o.multiplier}× segment`;
    case "plinko": return `🟣 Plinko: bucket ${o.bucket + 1}/${o.rows + 1} → ${r.multiplier}×`;
    case "roulette": return `🎯 Roulette ${o.pocket} ${o.color}`;
    case "darts": return `🎯 Darts: ring ${6 - o.band} → ${o.multiplier}×`;
    case "snakes": return o.multiplier ? `🪜 Snakes: ${o.multiplier}× square` : `🐍 Snakes: bitten`;
    case "keno": return `🔮 Keno: ${o.hits}/${o.picks.length} hit → ${r.multiplier}×`;
    default: return r.game;
  }
}
function moneyLine(stake, payout) {
  return payout > 0
    ? `returned ${toSol(payout)} (net ${payout >= stake ? "+" : "−"}${toSol(Math.abs(payout - stake))})`
    : `-${toSol(stake)}`;
}
function describeServer(out) {
  return `${describeOutcome(out.result)} — ${moneyLine(out.stakeLamports, out.payoutLamports)} SOL · bal ${toSol(out.balanceLamports)}`;
}
function describeLocal(r, stakeSol, payoutSol) {
  return `${describeOutcome(r)} — ${moneyLine(stakeSol * SOL, payoutSol * SOL)} SOL · bal ${bank().toFixed(4)}`;
}
function feedLocal(game, stakeSol, multiplier, payoutSol) {
  feed?.push({ game, stakeLamports: Math.round(stakeSol * SOL), multiplier, payoutLamports: Math.round(payoutSol * SOL) });
}

// Take a stake from the browser balance (no-server mode). Returns false if it can't.
function takeLocalStake(amount) {
  if (!(amount > 0)) { logResult("Enter a bet amount."); return false; }
  if (amount > bank() + 1e-12) { logResult("Insufficient balance."); return false; }
  bankSet(bank() - amount);
  return true;
}

// ---- Single-bet games: one handler shape ------------------------------------
// `onPlay(bet, amount)` resolves with the settled result; the game animates it
// and then calls `afterReveal()`, when the log line and the balance update appear.
function singleBet(gameId, localPlay) {
  return async (bet, amount) => {
    if (isBackend()) {
      if (!account) { logResult("Connect your wallet to play."); return null; }
      if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
      try {
        const out = await api.bet(gameId, bet, Math.round(amount * SOL));
        account.serverSeedHash = out.serverSeedHash;
        account.clientSeed = out.clientSeed;
        account.nonce = out.nonceUsed + 1;
        await refreshSeeds();
        return {
          outcome: out.result.outcome, win: out.result.win, multiplier: out.result.multiplier,
          payout: out.payoutLamports / SOL, stake: amount,
          afterReveal: () => { logResult(describeServer(out)); updateBalance(out.balanceLamports); feed?.refresh(); },
        };
      } catch (e) { logResult("error: " + e.message); return null; }
    }
    if (!takeLocalStake(amount)) return null;
    try {
      const r = await localPlay({ serverSeed, clientSeed, nonce }, bet);
      nonce++;
      await refreshSeeds();
      const payout = round9(amount * r.multiplier);
      return {
        outcome: r.outcome, win: r.win, multiplier: r.multiplier, payout, stake: amount,
        afterReveal: () => { bankSet(bank() + payout); logResult(describeLocal(r, amount, payout)); feedLocal(gameId, amount, r.multiplier, payout); },
      };
    } catch (e) {
      bankSet(bank() + amount); // nothing was played
      logResult("error: " + e.message);
      return null;
    }
  };
}

// ---- Dice -------------------------------------------------------------------
async function diceOnRoll({ target, direction, amount }) {
  const res = await singleBet("dice", playDice)({ target, direction }, amount);
  return res && { roll: res.outcome.roll, win: res.win, multiplier: res.multiplier, afterReveal: res.afterReveal };
}

// ---- Roulette: a table of chips on one spin ---------------------------------
async function rouletteOnSpin({ chips, total }) {
  if (isBackend()) {
    if (!account) { logResult("Connect your wallet to play."); return null; }
    try {
      const weighted = chips.map((c) => ({ bet: c.bet, weight: Math.round(c.amount * SOL) })).filter((c) => c.weight > 0);
      const stake = weighted.reduce((s, c) => s + c.weight, 0);
      const out = await api.bet("roulette", { type: "multi", bets: weighted }, stake);
      account.serverSeedHash = out.serverSeedHash;
      account.clientSeed = out.clientSeed;
      account.nonce = out.nonceUsed + 1;
      await refreshSeeds();
      return {
        pocket: out.result.outcome.pocket, color: out.result.outcome.color, payout: out.payoutLamports / SOL,
        afterSpin: () => { logResult(describeServer(out)); updateBalance(out.balanceLamports); feed?.refresh(); },
      };
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  if (!takeLocalStake(total)) return null;
  const pocket = await roulettePocket({ serverSeed, clientSeed, nonce });
  nonce++;
  await refreshSeeds();
  const payout = round9(rouletteSettle(chips, pocket));
  const r = { game: "roulette", outcome: { pocket, color: pocketColor(pocket) }, multiplier: payout / total };
  return {
    pocket, color: pocketColor(pocket), payout,
    afterSpin: () => { bankSet(bank() + payout); logResult(describeLocal(r, total, payout)); feedLocal("roulette", total, r.multiplier, payout); },
  };
}

// ---- Session games ----------------------------------------------------------
// Shared helpers for the four step-by-step games.
async function startSession(game, apiStart, label) {
  if (!account) { logResult("Connect your wallet to play."); return null; }
  try {
    const s = await apiStart();
    updateBalance(s.balanceLamports);
    account.nonce = s.nonceUsed + 1;
    await refreshSeeds();
    logResult(label);
    return s;
  } catch (e) { logResult("error: " + e.message); return null; }
}
function settleLocal(game, stake, multiplier) {
  const payout = round9(stake * multiplier);
  bankSet(bank() + payout);
  feedLocal(game, stake, multiplier, payout);
  return payout;
}

// Mines
let localMines = null;
async function minesOnStart({ mines, amount }) {
  if (isBackend()) {
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    return startSession("mines", () => api.mines.start(mines, Math.round(amount * SOL)), `💣 Mines (${mines}) started · stake ${amount}`);
  }
  if (!takeLocalStake(amount)) return null;
  localMines = { layout: await minesLayout({ serverSeed, clientSeed, nonce }, mines), mines, revealed: [], stake: amount };
  nonce++;
  await refreshSeeds();
  logResult(`💣 Mines (${mines}) started · stake ${amount}`);
  return { sessionId: "local" };
}
async function minesOnReveal(sessionId, tile) {
  if (isBackend()) {
    try {
      const r = await api.mines.reveal(sessionId, tile);
      if (r.completed || r.bust) { updateBalance(r.balanceLamports); feed?.refresh(); }
      if (r.bust) logResult("💥 Mines — hit a mine. Lost.");
      else if (r.completed) logResult(`🏆 Mines cleared! ×${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const m = localMines;
  if (m.layout.includes(tile)) {
    settleLocal("mines", m.stake, 0);
    logResult("💥 Mines — hit a mine. Lost.");
    return { safe: false, bust: true, tile, minePositions: m.layout, revealed: m.revealed, multiplier: 0 };
  }
  m.revealed.push(tile);
  const k = m.revealed.length;
  const completed = k >= 25 - m.mines;
  const multiplier = minesMultiplier(m.mines, k);
  if (completed) { settleLocal("mines", m.stake, multiplier); logResult(`🏆 Mines cleared! ×${multiplier}`); }
  return {
    safe: true, bust: false, tile, revealed: [...m.revealed], multiplier,
    nextMultiplier: completed ? null : minesMultiplier(m.mines, k + 1), completed,
    minePositions: completed ? m.layout : undefined,
  };
}
async function minesOnCashout(sessionId) {
  if (isBackend()) {
    try {
      const r = await api.mines.cashout(sessionId);
      updateBalance(r.balanceLamports);
      feed?.refresh();
      logResult(`💰 Mines cashed out ×${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const mult = minesMultiplier(localMines.mines, localMines.revealed.length);
  settleLocal("mines", localMines.stake, mult);
  logResult(`💰 Mines cashed out ×${mult}`);
  return { multiplier: mult, minePositions: localMines.layout, revealed: localMines.revealed };
}

// HiLo
let localHilo = null;
const floor2 = (x) => Math.floor(x * 100) / 100;
const hiloChance = (base, guess) => (guess === "higherOrSame" ? (HILO_RANKS - base) / HILO_RANKS : (base + 1) / HILO_RANKS);
async function hiloOnStart({ amount }) {
  if (isBackend()) {
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    return startSession("hilo", () => api.hilo.start(Math.round(amount * SOL)), `🃏 HiLo dealt · stake ${amount}`);
  }
  if (!takeLocalStake(amount)) return null;
  const fs = await floats(serverSeed, clientSeed, nonce, 30);
  const cards = fs.map((f) => ({ rank: Math.floor(f * HILO_RANKS), suit: Math.floor(f * 52) % 4 }));
  localHilo = { cards, dealt: 1, multiplier: 1, stake: amount };
  nonce++;
  await refreshSeeds();
  logResult(`🃏 HiLo dealt · stake ${amount}`);
  return { sessionId: "local", base: cards[0] };
}
async function hiloOnGuess(sessionId, guess) {
  if (isBackend()) {
    try {
      const r = await api.hilo.guess(sessionId, guess);
      if (r.bust || r.completed) { updateBalance(r.balanceLamports); feed?.refresh(); }
      if (r.bust) logResult("🃏 HiLo — wrong call. Lost.");
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const h = localHilo;
  const base = h.cards[h.dealt - 1].rank;
  const card = h.cards[h.dealt];
  h.dealt++;
  const win = guess === "higherOrSame" ? card.rank >= base : card.rank <= base;
  if (!win) { settleLocal("hilo", h.stake, 0); logResult("🃏 HiLo — wrong call. Lost."); return { card, win: false, bust: true, multiplier: 0 }; }
  h.multiplier = floor2(h.multiplier * floor2((1 / hiloChance(base, guess)) * (1 - HOUSE_EDGE)));
  const completed = h.dealt >= 30;
  if (completed) settleLocal("hilo", h.stake, h.multiplier);
  return { card, win: true, bust: false, multiplier: h.multiplier, completed };
}
async function hiloOnCashout(sessionId) {
  if (isBackend()) {
    try {
      const r = await api.hilo.cashout(sessionId);
      updateBalance(r.balanceLamports);
      feed?.refresh();
      logResult(`💰 HiLo cashed out ×${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  settleLocal("hilo", localHilo.stake, localHilo.multiplier);
  logResult(`💰 HiLo cashed out ×${localHilo.multiplier}`);
  return { multiplier: localHilo.multiplier };
}

// Tower
let localTower = null;
async function towerOnStart({ difficulty, amount }) {
  if (isBackend()) {
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    return startSession("tower", () => api.tower.start(difficulty, Math.round(amount * SOL)), `🧗 Tower (${difficulty}) started · stake ${amount}`);
  }
  if (!takeLocalStake(amount)) return null;
  localTower = { layout: await towerLayout({ serverSeed, clientSeed, nonce }, difficulty), difficulty, rowsClimbed: 0, stake: amount };
  nonce++;
  await refreshSeeds();
  logResult(`🧗 Tower (${difficulty}) started · stake ${amount}`);
  return { sessionId: "local", cols: 4, rows: TOWER_ROWS };
}
async function towerOnReveal(sessionId, pick) {
  if (isBackend()) {
    try {
      const r = await api.tower.reveal(sessionId, pick);
      if (r.completed || r.bust) { updateBalance(r.balanceLamports); feed?.refresh(); }
      if (r.bust) logResult("💥 Tower trap — lost.");
      else if (r.completed) logResult(`🏆 Tower topped out x${r.multiplier}!`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const t = localTower;
  const traps = t.layout[t.rowsClimbed];
  if (traps.includes(pick)) {
    const row = t.rowsClimbed;
    settleLocal("tower", t.stake, 0);
    logResult(`💥 Tower trap on row ${row + 1}. Lost.`);
    return { safe: false, bust: true, row, pick, rowTraps: traps, multiplier: 0, rowsClimbed: row };
  }
  t.rowsClimbed++;
  const multiplier = towerMultiplier(t.difficulty, t.rowsClimbed);
  const completed = t.rowsClimbed >= TOWER_ROWS;
  if (completed) { settleLocal("tower", t.stake, multiplier); logResult(`🏆 Tower topped out x${multiplier}!`); }
  return { safe: true, bust: false, row: t.rowsClimbed - 1, pick, rowTraps: traps, multiplier, rowsClimbed: t.rowsClimbed, completed };
}
async function towerOnCashout(sessionId) {
  if (isBackend()) {
    try {
      const r = await api.tower.cashout(sessionId);
      updateBalance(r.balanceLamports);
      feed?.refresh();
      logResult(`💰 Tower cashed out x${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const m = towerMultiplier(localTower.difficulty, localTower.rowsClimbed);
  settleLocal("tower", localTower.stake, m);
  logResult(`💰 Tower cashed out x${m}`);
  return { multiplier: m, rowsClimbed: localTower.rowsClimbed };
}

// Chicken
let localChicken = null;
async function chickenOnStart({ difficulty, amount }) {
  if (isBackend()) {
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    return startSession("chicken", () => api.chicken.start(difficulty, Math.round(amount * SOL)), `🐔 Chicken (${difficulty}) started · stake ${amount}`);
  }
  if (!takeLocalStake(amount)) return null;
  localChicken = { deathPoint: await chickenDeathPoint({ serverSeed, clientSeed, nonce }, difficulty), difficulty, stepsTaken: 0, stake: amount };
  nonce++;
  await refreshSeeds();
  logResult(`🐔 Chicken (${difficulty}) started · stake ${amount}`);
  return { sessionId: "local" };
}
async function chickenOnStep(sessionId) {
  if (isBackend()) {
    try {
      const r = await api.chicken.step(sessionId);
      if (r.completed || r.bust) { updateBalance(r.balanceLamports); feed?.refresh(); }
      if (r.bust) logResult("💥 Chicken caught — lost.");
      else if (r.completed) logResult(`🏆 Chicken made it! x${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const t = localChicken;
  if (t.stepsTaken + 1 === t.deathPoint) {
    const step = t.stepsTaken;
    settleLocal("chicken", t.stake, 0);
    logResult(`💥 Chicken caught on lane ${step + 1}. Lost.`);
    return { survived: false, bust: true, step, multiplier: 0, stepsTaken: step };
  }
  t.stepsTaken++;
  const multiplier = chickenMultiplier(t.difficulty, t.stepsTaken);
  const completed = t.stepsTaken >= chickenMaxSteps(t.difficulty);
  if (completed) { settleLocal("chicken", t.stake, multiplier); logResult(`🏆 Chicken made it! x${multiplier}`); }
  return { survived: true, bust: false, step: t.stepsTaken - 1, multiplier, stepsTaken: t.stepsTaken, completed };
}
async function chickenOnCashout(sessionId) {
  if (isBackend()) {
    try {
      const r = await api.chicken.cashout(sessionId);
      updateBalance(r.balanceLamports);
      feed?.refresh();
      logResult(`💰 Chicken cashed out x${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const m = chickenMultiplier(localChicken.difficulty, localChicken.stepsTaken);
  settleLocal("chicken", localChicken.stake, m);
  logResult(`💰 Chicken cashed out x${m}`);
  return { multiplier: m, stepsTaken: localChicken.stepsTaken };
}

// ---- Verify widget ----------------------------------------------------------
$("#verify-btn").addEventListener("click", async () => {
  const seed = $("#verify-seed").value.trim();
  const hash = $("#verify-hash").value.trim();
  if (!seed || !hash) {
    $("#verify-out").textContent = "Paste a server seed and its committed hash.";
    return;
  }
  const ok = await verifyCommitment(seed, hash);
  $("#verify-out").textContent = ok
    ? "✓ Match — this server seed produced that commitment. Untampered."
    : "✗ No match — the seed does not hash to that commitment.";
  $("#verify-out").className = "verify-out " + (ok ? "ok" : "bad");
});

// ---- Chat -------------------------------------------------------------------
const chat = new Chat($("#chat-list"), $("#chat-input"), $("#chat-form"));

// ---- Start ------------------------------------------------------------------
async function init() {
  await detectBackend();
  if (isBackend()) {
    try {
      serverCfg = await api.config();
      setActiveCluster(serverCfg.cluster);
    } catch { /* keep defaults */ }
    feed = createFeed($("#feed-panel"), { fetchRecent: api.betsRecent, fetchMine: () => (account ? api.betsMine() : Promise.resolve({ bets: [] })) });
    feed.start();
  } else {
    feed = createFeed($("#feed-panel"), {});
    feed.start();
    showBalance(bank());
    chat.startAmbient(); // a lively room; with real money on, only real messages show
  }
  setModeNote();
  selectGame("dice");

  if (isBackend() && api.hasToken()) {
    try {
      account = (await api.me()).account;
      connected = account.pubkey;
      const provider = await restoreWallet(); // so deposits can be signed without a fresh connect
      provider?.onAccountChanged(onAccountChanged);
      await afterSignIn();
      walletPanel?.retryPending?.();
    } catch (e) {
      if (e.status === 401) {
        api.clearToken(); // the session is gone: connect again to see the same balance
        account = null;
        connected = null;
      } else {
        walletInfo.textContent = "can't reach the server — your balance is safe; reload to try again";
      }
    }
  }
  await refreshSeeds();
}
init();
