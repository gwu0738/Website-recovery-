// =============================================================================
// App bootstrap — wires branding, socials, games grid, the playable bet panel,
// wallet connect, and the live chat together.
// =============================================================================
import { BRAND, SOCIALS, HOUSE_EDGE, CLUSTER, toSol, setActiveCluster, getActiveCluster } from "./config.js";
import { randomHex, hashServerSeed, verifyCommitment } from "./fairness.js";
import {
  playDice, playLimbo, playCrash, playCoinflip, playWheel, playPlinko, playDarts, playSnakes, playKeno,
  minesLayout, minesMultiplier, HILO_RANKS, GAME_CATALOG,
} from "./games.js";
import { floats } from "./fairness.js";
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
import { connect, disconnect, getBalanceSol, getProvider } from "./wallet.js";
import { roulettePocket, rouletteSettle, pocketColor } from "./roulette-logic.js";
import { createRouletteGame } from "./roulette-game.js";
import { api, BACKEND_ENABLED } from "./api.js";
import { createWalletPanel } from "./wallet-panel.js";
import { createDiceGame } from "./dice-game.js";
import { createTowerGame } from "./tower-game.js";
import { towerLayout, towerMultiplier, TOWER_ROWS } from "./tower-logic.js";
import { createChickenGame } from "./chicken-game.js";
import { chickenDeathPoint, chickenMultiplier, chickenMaxSteps } from "./chicken-logic.js";
import { Chat } from "./chat.js";

const $ = (sel) => document.querySelector(sel);

// In BACKEND mode, holds the signed-in account; null until sign-in.
let account = null;
const SOL = 1_000_000_000;

// ---- Branding + socials -----------------------------------------------------
document.title = BRAND.name;
$("#brand-name").textContent = BRAND.name;
$("#brand-tag").textContent = BRAND.tagline;
$("#footer-brand").textContent = BRAND.name;
const fb2 = $("#footer-brand2");
if (fb2) fb2.textContent = BRAND.name;
$("#year").textContent = new Date().getFullYear();
$("#edge-label").textContent = (HOUSE_EDGE * 100).toFixed(1) + "%";

for (const [key, url] of Object.entries(SOCIALS)) {
  if (!url) continue;
  document.querySelectorAll(`[data-social="${key}"]`).forEach((el) => {
    el.href = url;
    el.classList.remove("hidden");
  });
}

// ---- Wallet -----------------------------------------------------------------
const walletBtn = $("#wallet-btn");
const walletInfo = $("#wallet-info");
$("#cluster-badge").textContent = CLUSTER;
if (CLUSTER === "mainnet") $("#cluster-badge").classList.add("mainnet");

let connected = null;
walletBtn.addEventListener("click", async () => {
  try {
    if (connected) {
      await disconnect();
      await signOut();
      walletBtn.textContent = "Connect Wallet";
      walletInfo.textContent = "";
      $("#account-row").classList.add("hidden");
      $("#wallet-panel").classList.add("hidden");
      $("#wallet-open").setAttribute("aria-expanded", "false");
      await refreshSeeds();
      return;
    }
    const provider = getProvider();
    if (!provider) {
      walletInfo.textContent = "Phantom not detected — install phantom.app";
      return;
    }
    const addr = await connect();
    connected = addr;
    walletBtn.textContent = addr.slice(0, 4) + "…" + addr.slice(-4);

    if (BACKEND_ENABLED) {
      // Real sign-in: prove wallet ownership, then load the account.
      walletInfo.textContent = "signing in…";
      account = await api.signIn(provider, addr);
      $("#account-row").classList.remove("hidden");
      await afterSignIn();
      walletInfo.textContent = `signed in (${getActiveCluster()})`;
      updateBalance(account.balanceLamports);
      await refreshSeeds();
    } else {
      // Demo mode: just read the on-chain balance for display.
      walletInfo.textContent = "checking balance…";
      try {
        const bal = await getBalanceSol(addr);
        walletInfo.textContent = `${bal.toFixed(4)} SOL (${CLUSTER})`;
      } catch {
        walletInfo.textContent = `connected — balance read failed (${CLUSTER} RPC)`;
      }
    }
  } catch (e) {
    walletInfo.textContent = e.message || "connection failed";
  }
});

function updateBalance(lamports) {
  $("#balance-val").textContent = toSol(lamports);
}

// Leave the signed-in state. The balance lives with the wallet on the server,
// so signing out never loses anything — signing back in shows the same amount.
async function signOut() {
  if (BACKEND_ENABLED && api.hasToken()) {
    try { await api.logout(); } catch { /* token may already be gone */ }
  }
  connected = null;
  account = null;
  api.clearToken();
  $("#resume-banner").classList.add("hidden");
}

// Phantom lets people switch accounts without reconnecting. A deposit from the
// new account would never be credited to the old sign-in, so follow the switch.
getProvider()?.on?.("accountChanged", async (pk) => {
  const next = pk ? pk.toString() : null;
  if (!connected || next === connected) return;
  await signOut();
  walletBtn.textContent = "Connect Wallet";
  $("#account-row").classList.add("hidden");
  $("#wallet-panel").classList.add("hidden");
  walletInfo.textContent = next
    ? "Phantom switched accounts — connect again to sign in with it"
    : "Phantom disconnected";
  await refreshSeeds();
});

// After sign-in: follow the server's Solana cluster, then set up the wallet panel.
let walletPanel = null;
async function afterSignIn() {
  try {
    const cfg = await api.config();
    setActiveCluster(cfg.cluster);
    $("#mode-note").textContent =
      `Real SOL on ${cfg.cluster}: every bet moves your balance, and deposits and ` +
      `withdrawals are on-chain transactions. 18+. Only play with what you can afford to lose.`;
    $("#cluster-badge").textContent = cfg.cluster;
    $("#cluster-badge").classList.toggle("mainnet", cfg.cluster === "mainnet");
  } catch {
    /* keep the default cluster */
  }
  walletPanel = createWalletPanel($("#wallet-panel"), {
    getProvider,
    getAddress: () => connected ?? account?.pubkey,
    onBalance: updateBalance,
    log: logResult,
  });
  await showUnfinishedGames();
}

// ---- Unfinished games: a stake locked in a Tower/Chicken game must never be
// lost to a page refresh. Offer to resume it (or cash out) right away.
async function showUnfinishedGames() {
  const banner = $("#resume-banner");
  banner.classList.add("hidden");
  if (!BACKEND_ENABLED || !account) return;
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
  const progressText = `${progress} ${progress === 1 ? one : many}`;
  banner.innerHTML =
    `<span class="grow">You have an unfinished <strong>${name}</strong> game${p.difficulty ? ` (${p.difficulty})` : p.mines ? ` (${p.mines} mines)` : ""} with ` +
    `<strong>${toSol(s.stakeLamports)} SOL</strong> staked · ${progressText} · x${p.multiplier}` +
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

$("#wallet-open").addEventListener("click", () => {
  const panel = $("#wallet-panel");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  $("#wallet-open").setAttribute("aria-expanded", String(opening));
  if (opening) walletPanel?.refresh();
});

// ---- Games grid -------------------------------------------------------------
const grid = $("#games-grid");
for (const g of GAME_CATALOG) {
  const card = document.createElement("button");
  card.className = "game-card" + (g.playable ? "" : " soon");
  card.dataset.game = g.id;
  card.innerHTML =
    `<span class="game-ico-wrap">${g.icon ?? ""}</span>` +
    `<span class="game-name">${g.name}</span>` +
    `<span class="game-blurb">${g.blurb}</span>` +
    (g.playable ? "" : `<span class="game-soon">soon</span>`);
  if (g.playable) card.addEventListener("click", () => selectGame(g.id));
  grid.appendChild(card);
}

// ---- Bet panel (provably fair, in-browser) ----------------------------------
// A fresh seed pair per session; nonce increments each bet.
let serverSeed = randomHex(32);
let clientSeed = randomHex(8);
let nonce = 1;
let currentGame = "dice";

async function refreshSeeds() {
  if (BACKEND_ENABLED && account) {
    $("#seed-hash").textContent = account.serverSeedHash;
    $("#seed-client").textContent = account.clientSeed;
    $("#seed-nonce").textContent = account.nonce;
    return;
  }
  $("#seed-hash").textContent = await hashServerSeed(serverSeed);
  $("#seed-client").textContent = clientSeed;
  $("#seed-nonce").textContent = nonce;
}

// Every game has its own interactive UI; the app just wires each to the engine.
const RICH_GAMES = new Set(GAME_CATALOG.map((g) => g.id));
let currentGameUi = null;

function mountGame(id) {
  const view = $("#game-view");
  view.innerHTML = "";
  const amountLabel = BACKEND_ENABLED ? "Bet (SOL)" : "Bet";
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
  else if (id === "mines") {
    currentGameUi = createMinesGame(view, { onStart: minesOnStart, onReveal: minesOnReveal, onCashout: minesOnCashout, amountLabel });
  } else if (id === "hilo") {
    currentGameUi = createHiLoGame(view, { onStart: hiloOnStart, onGuess: hiloOnGuess, onCashout: hiloOnCashout, amountLabel });
  } else if (id === "tower") {
    currentGameUi = createTowerGame(view, {
      onStart: towerOnStart,
      onReveal: towerOnReveal,
      onCashout: towerOnCashout,
      amountLabel,
    });
  } else if (id === "chicken") {
    currentGameUi = createChickenGame(view, {
      onStart: chickenOnStart,
      onStep: chickenOnStep,
      onCashout: chickenOnCashout,
      amountLabel,
    });
  } else if (id === "roulette") {
    currentGameUi = createRouletteGame(view, { onSpin: rouletteOnSpin, amountLabel });
  }
}

function selectGame(id) {
  currentGame = id;
  grid.querySelectorAll(".game-card").forEach((c) => c.classList.toggle("active", c.dataset.game === id));
  $("#panel-title").textContent = GAME_CATALOG.find((g) => g.id === id).name;
  $("#bet-controls").dataset.game = id;
  mountGame(id);
}

$("#new-seed").addEventListener("click", async () => {
  if (BACKEND_ENABLED && account) {
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
  logResult("↻ New seed pair generated. Old server seed is now revealable.");
});

$("#faucet-btn").addEventListener("click", async () => {
  if (!account) return;
  try {
    const r = await api.faucet();
    updateBalance(r.balanceLamports);
    logResult(`🚰 Faucet credited +${toSol(r.creditedLamports)} SOL`);
  } catch (e) {
    logResult("faucet: " + e.message);
  }
});

// One line describing a settled bet: same wording in demo and backend mode.
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
function describeServer(out) {
  const money = out.payoutLamports > 0
    ? `returned ${toSol(out.payoutLamports)} (net ${out.payoutLamports >= out.stakeLamports ? "+" : "−"}${toSol(Math.abs(out.payoutLamports - out.stakeLamports))})`
    : `-${toSol(out.stakeLamports)}`;
  return `${describeOutcome(out.result)} — ${money} SOL · bal ${toSol(out.balanceLamports)}`;
}
function describeDemo(r, stake) {
  const verdict = r.multiplier > 0 ? `returned ${+(stake * r.multiplier).toFixed(6)} on ${stake}` : `lost ${stake}`;
  return `${describeOutcome(r)} — ${verdict} (demo)`;
}

// ---- Single-bet games: one handler shape for all of them -------------------
// `onPlay(bet, amount)` resolves with the settled result; the game animates it
// and then calls `afterReveal()`, which is when the log line and the balance
// update appear (so an animation never gives the result away early).
function singleBet(gameId, demoPlay) {
  return async (bet, amount) => {
    if (BACKEND_ENABLED) {
      if (!account) { logResult("Connect your wallet to sign in first."); return null; }
      if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
      try {
        const out = await api.bet(gameId, bet, Math.round(amount * SOL));
        account.serverSeedHash = out.serverSeedHash;
        account.clientSeed = out.clientSeed;
        account.nonce = out.nonceUsed + 1;
        await refreshSeeds();
        return {
          outcome: out.result.outcome,
          win: out.result.win,
          multiplier: out.result.multiplier,
          payout: out.payoutLamports / SOL,
          stake: amount,
          afterReveal: () => { logResult(describeServer(out)); updateBalance(out.balanceLamports); },
        };
      } catch (e) { logResult("error: " + e.message); return null; }
    }
    try {
      const r = await demoPlay({ serverSeed, clientSeed, nonce }, bet);
      nonce++;
      await refreshSeeds();
      return {
        outcome: r.outcome,
        win: r.win,
        multiplier: r.multiplier,
        payout: amount * r.multiplier,
        stake: amount,
        afterReveal: () => logResult(describeDemo(r, amount)),
      };
    } catch (e) { logResult("error: " + e.message); return null; }
  };
}

function logResult(line) {
  const log = $("#result-log");
  const row = document.createElement("div");
  row.className = "result-row";
  row.textContent = line;
  log.prepend(row);
  while (log.children.length > 12) log.removeChild(log.lastChild);
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
  $("#verify-out").className = ok ? "ok" : "bad";
});

// ---- Dice (rich interactive game) ------------------------------------------
async function diceOnRoll({ target, direction, amount }) {
  if (BACKEND_ENABLED) {
    if (!account) {
      logResult("Connect your wallet to sign in first.");
      return null;
    }
    if (!(amount > 0)) {
      logResult("Enter a bet amount.");
      return null;
    }
    try {
      const out = await api.bet("dice", { target, direction }, Math.round(amount * SOL));
      account.serverSeedHash = out.serverSeedHash;
      account.clientSeed = out.clientSeed;
      account.nonce = out.nonceUsed + 1;
      await refreshSeeds();
      return {
        roll: out.result.outcome.roll,
        win: out.result.win,
        multiplier: out.result.multiplier,
        afterReveal: () => { logResult(describeServer(out)); updateBalance(out.balanceLamports); },
      };
    } catch (e) {
      logResult("error: " + e.message);
      return null;
    }
  }
  // demo mode
  const res = await playDice({ serverSeed, clientSeed, nonce }, { target, direction });
  nonce++;
  await refreshSeeds();
  return { roll: res.outcome.roll, win: res.win, multiplier: res.multiplier, afterReveal: () => logResult(describeDemo(res, amount)) };
}

// ---- Roulette (rich interactive game: a table of chips on one spin) --------
// The result is decided before the wheel moves; the balance/log update waits
// in `afterSpin` until the ball has landed so the animation isn't spoiled.
async function rouletteOnSpin({ chips, total }) {
  if (BACKEND_ENABLED) {
    if (!account) { logResult("Connect your wallet to sign in first."); return null; }
    if (!(total > 0)) { logResult("Place at least one chip."); return null; }
    try {
      const weighted = chips.map((c) => ({ bet: c.bet, weight: Math.round(c.amount * SOL) })).filter((c) => c.weight > 0);
      const stake = weighted.reduce((s, c) => s + c.weight, 0);
      const out = await api.bet("roulette", { type: "multi", bets: weighted }, stake);
      account.serverSeedHash = out.serverSeedHash;
      account.clientSeed = out.clientSeed;
      account.nonce = out.nonceUsed + 1;
      await refreshSeeds();
      return {
        pocket: out.result.outcome.pocket,
        color: out.result.outcome.color,
        payout: out.payoutLamports / SOL,
        afterSpin: () => {
          logResult(describeServer(out));
          updateBalance(out.balanceLamports);
        },
      };
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  // demo: same math on the in-browser seeds
  const pocket = await roulettePocket({ serverSeed, clientSeed, nonce });
  nonce++;
  await refreshSeeds();
  const payout = rouletteSettle(chips, pocket);
  return {
    pocket,
    color: pocketColor(pocket),
    payout,
    afterSpin: () => logResult(`🎯 Roulette ${pocket} ${pocketColor(pocket)} — ${payout > 0 ? `returned ${payout} on ${total} staked` : `lost ${total}`}`),
  };
}

// ---- Mines (session: reveal tile by tile) -----------------------------------
let demoMines = null;

async function minesOnStart({ mines, amount }) {
  if (BACKEND_ENABLED) {
    if (!account) { logResult("Connect your wallet to sign in first."); return null; }
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    try {
      const s = await api.mines.start(mines, Math.round(amount * SOL));
      updateBalance(s.balanceLamports);
      account.nonce = s.nonceUsed + 1;
      await refreshSeeds();
      logResult(`💣 Mines (${mines}) started · stake ${amount}`);
      return s;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const layout = await minesLayout({ serverSeed, clientSeed, nonce }, mines);
  demoMines = { layout, mines, revealed: [] };
  nonce++;
  await refreshSeeds();
  logResult(`💣 Mines (${mines}) started (demo)`);
  return { sessionId: "demo" };
}
async function minesOnReveal(sessionId, tile) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.mines.reveal(sessionId, tile);
      if (r.completed || r.bust) updateBalance(r.balanceLamports);
      if (r.bust) logResult("💥 Mines — hit a mine. Lost.");
      else if (r.completed) logResult(`🏆 Mines cleared! ×${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const m = demoMines;
  if (m.layout.includes(tile)) {
    logResult("💥 Mines — hit a mine (demo)");
    return { safe: false, bust: true, tile, minePositions: m.layout, revealed: m.revealed, multiplier: 0 };
  }
  m.revealed.push(tile);
  const k = m.revealed.length;
  const completed = k >= 25 - m.mines;
  if (completed) logResult(`🏆 Mines cleared! ×${minesMultiplier(m.mines, k)} (demo)`);
  return {
    safe: true, bust: false, tile, revealed: [...m.revealed], multiplier: minesMultiplier(m.mines, k),
    nextMultiplier: completed ? null : minesMultiplier(m.mines, k + 1), completed,
    minePositions: completed ? m.layout : undefined,
  };
}
async function minesOnCashout(sessionId) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.mines.cashout(sessionId);
      updateBalance(r.balanceLamports);
      logResult(`💰 Mines cashed out ×${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const mult = minesMultiplier(demoMines.mines, demoMines.revealed.length);
  logResult(`💰 Mines cashed out ×${mult} (demo)`);
  return { multiplier: mult, minePositions: demoMines.layout, revealed: demoMines.revealed };
}

// ---- HiLo (session: a fixed card stream, call by call) ----------------------
let demoHilo = null;
const floor2 = (x) => Math.floor(x * 100) / 100;
const hiloChance = (base, guess) => (guess === "higherOrSame" ? (HILO_RANKS - base) / HILO_RANKS : (base + 1) / HILO_RANKS);

async function hiloOnStart({ amount }) {
  if (BACKEND_ENABLED) {
    if (!account) { logResult("Connect your wallet to sign in first."); return null; }
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    try {
      const s = await api.hilo.start(Math.round(amount * SOL));
      updateBalance(s.balanceLamports);
      account.nonce = s.nonceUsed + 1;
      await refreshSeeds();
      logResult(`🃏 HiLo dealt · stake ${amount}`);
      return s;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const fs = await floats(serverSeed, clientSeed, nonce, 30);
  const cards = fs.map((f) => ({ rank: Math.floor(f * HILO_RANKS), suit: Math.floor(f * 52) % 4 }));
  demoHilo = { cards, dealt: 1, multiplier: 1, calls: 0 };
  nonce++;
  await refreshSeeds();
  logResult("🃏 HiLo dealt (demo)");
  return { sessionId: "demo", base: cards[0] };
}
async function hiloOnGuess(sessionId, guess) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.hilo.guess(sessionId, guess);
      if (r.bust || r.completed) updateBalance(r.balanceLamports);
      if (r.bust) logResult("🃏 HiLo — wrong call. Lost.");
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const h = demoHilo;
  const base = h.cards[h.dealt - 1].rank;
  const card = h.cards[h.dealt];
  h.dealt++;
  const win = guess === "higherOrSame" ? card.rank >= base : card.rank <= base;
  if (!win) { logResult("🃏 HiLo — wrong call (demo)"); return { card, win: false, bust: true, multiplier: 0 }; }
  h.calls++;
  h.multiplier = floor2(h.multiplier * floor2((1 / hiloChance(base, guess)) * (1 - HOUSE_EDGE)));
  return { card, win: true, bust: false, multiplier: h.multiplier, completed: h.dealt >= 30 };
}
async function hiloOnCashout(sessionId) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.hilo.cashout(sessionId);
      updateBalance(r.balanceLamports);
      logResult(`💰 HiLo cashed out ×${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  logResult(`💰 HiLo cashed out ×${demoHilo.multiplier} (demo)`);
  return { multiplier: demoHilo.multiplier };
}

// ---- Tower (rich interactive game: stateful reveals) -----------------------
// Demo mode keeps the layout client-side; backend mode uses the session API.
let demoTower = null;

async function towerOnStart({ difficulty, amount }) {
  if (BACKEND_ENABLED) {
    if (!account) { logResult("Connect your wallet to sign in first."); return null; }
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    try {
      const s = await api.tower.start(difficulty, Math.round(amount * SOL));
      updateBalance(s.balanceLamports);
      account.nonce = s.nonceUsed + 1;
      await refreshSeeds();
      logResult(`🧗 Tower (${difficulty}) started · stake ${amount}`);
      return s;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  // demo: fix the layout from the current demo seeds
  const layout = await towerLayout({ serverSeed, clientSeed, nonce }, difficulty);
  demoTower = { layout, difficulty, rowsClimbed: 0, stake: amount };
  nonce++;
  await refreshSeeds();
  logResult(`🧗 Tower (${difficulty}) started (demo)`);
  return { sessionId: "demo", cols: 4, rows: TOWER_ROWS };
}

async function towerOnReveal(sessionId, pick) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.tower.reveal(sessionId, pick);
      if (r.completed || r.bust) updateBalance(r.balanceLamports);
      if (r.bust) logResult(`💥 Tower trap — lost.`);
      else if (r.completed) logResult(`🏆 Tower topped out x${r.multiplier}!`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  // demo
  const t = demoTower;
  const traps = t.layout[t.rowsClimbed];
  if (traps.includes(pick)) {
    const row = t.rowsClimbed;
    logResult(`💥 Tower trap on row ${row + 1} (demo)`);
    return { safe: false, bust: true, row, pick, rowTraps: traps, multiplier: 0, rowsClimbed: row };
  }
  t.rowsClimbed++;
  const multiplier = towerMultiplier(t.difficulty, t.rowsClimbed);
  const completed = t.rowsClimbed >= TOWER_ROWS;
  if (completed) logResult(`🏆 Tower topped out x${multiplier} (demo)`);
  return {
    safe: true, bust: false, row: t.rowsClimbed - 1, pick, rowTraps: traps,
    multiplier, rowsClimbed: t.rowsClimbed, completed,
  };
}

async function towerOnCashout(sessionId) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.tower.cashout(sessionId);
      updateBalance(r.balanceLamports);
      logResult(`💰 Tower cashed out x${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const m = towerMultiplier(demoTower.difficulty, demoTower.rowsClimbed);
  logResult(`💰 Tower cashed out x${m} (demo)`);
  return { multiplier: m, rowsClimbed: demoTower.rowsClimbed };
}

// ---- Chicken (rich interactive game: stateful steps) -----------------------
let demoChicken = null;

async function chickenOnStart({ difficulty, amount }) {
  if (BACKEND_ENABLED) {
    if (!account) { logResult("Connect your wallet to sign in first."); return null; }
    if (!(amount > 0)) { logResult("Enter a bet amount."); return null; }
    try {
      const s = await api.chicken.start(difficulty, Math.round(amount * SOL));
      updateBalance(s.balanceLamports);
      account.nonce = s.nonceUsed + 1;
      await refreshSeeds();
      logResult(`🐔 Chicken (${difficulty}) started · stake ${amount}`);
      return s;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const deathPoint = await chickenDeathPoint({ serverSeed, clientSeed, nonce }, difficulty);
  demoChicken = { deathPoint, difficulty, stepsTaken: 0 };
  nonce++;
  await refreshSeeds();
  logResult(`🐔 Chicken (${difficulty}) started (demo)`);
  return { sessionId: "demo" };
}

async function chickenOnStep(sessionId) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.chicken.step(sessionId);
      if (r.completed || r.bust) updateBalance(r.balanceLamports);
      if (r.bust) logResult(`💥 Chicken caught — lost.`);
      else if (r.completed) logResult(`🏆 Chicken made it! x${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const t = demoChicken;
  if (t.stepsTaken + 1 === t.deathPoint) {
    const step = t.stepsTaken;
    logResult(`💥 Chicken caught on lane ${step + 1} (demo)`);
    return { survived: false, bust: true, step, multiplier: 0, stepsTaken: step };
  }
  t.stepsTaken++;
  const multiplier = chickenMultiplier(t.difficulty, t.stepsTaken);
  const completed = t.stepsTaken >= chickenMaxSteps(t.difficulty);
  if (completed) logResult(`🏆 Chicken made it! x${multiplier} (demo)`);
  return { survived: true, bust: false, step: t.stepsTaken - 1, multiplier, stepsTaken: t.stepsTaken, completed };
}

async function chickenOnCashout(sessionId) {
  if (BACKEND_ENABLED) {
    try {
      const r = await api.chicken.cashout(sessionId);
      updateBalance(r.balanceLamports);
      logResult(`💰 Chicken cashed out x${r.multiplier}`);
      return r;
    } catch (e) { logResult("error: " + e.message); return null; }
  }
  const m = chickenMultiplier(demoChicken.difficulty, demoChicken.stepsTaken);
  logResult(`💰 Chicken cashed out x${m} (demo)`);
  return { multiplier: m, stepsTaken: demoChicken.stepsTaken };
}

// ---- Chat -------------------------------------------------------------------
const chat = new Chat($("#chat-list"), $("#chat-input"), $("#chat-form"));
// Simulated chatter is for the demo only. With real money on, fake players and
// fake wins would mislead real people, so the room shows only real messages.
if (!BACKEND_ENABLED) chat.startAmbient();

// init
selectGame("dice");

// Restore a previous backend session if one exists.
async function init() {
  if (BACKEND_ENABLED && api.hasToken()) {
    try {
      account = (await api.me()).account;
      connected = account.pubkey;
      walletBtn.textContent = account.pubkey.slice(0, 4) + "…" + account.pubkey.slice(-4);
      $("#account-row").classList.remove("hidden");
      await afterSignIn();
      $("#wallet-info").textContent = `signed in (${getActiveCluster()})`;
      updateBalance(account.balanceLamports);
      // Credit any deposit this browser sent but never got to confirm.
      walletPanel?.retryPending?.();
    } catch (e) {
      if (e.status === 401) {
        api.clearToken(); // the session really is gone: sign in again to see the same balance
      } else {
        // Server unreachable: keep the token so a reload restores the session.
        $("#wallet-info").textContent = "can't reach the server — your balance is safe; reload to try again";
      }
    }
  }
  await refreshSeeds();
}
init();
