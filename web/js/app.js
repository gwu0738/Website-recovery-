// =============================================================================
// App bootstrap — wires branding, socials, games grid, the playable bet panel,
// wallet connect, and the live chat together.
// =============================================================================
import { BRAND, SOCIALS, HOUSE_EDGE, CLUSTER, toSol } from "./config.js";
import { randomHex, hashServerSeed, verifyCommitment } from "./fairness.js";
import { playDice, playLimbo, playCoinflip, playWheel, GAME_CATALOG } from "./games.js";
import { connect, disconnect, getBalanceSol, getProvider } from "./wallet.js";
import { api, BACKEND_ENABLED } from "./api.js";
import { createDiceGame } from "./dice-game.js";
import { createTowerGame } from "./tower-game.js";
import { towerLayout, towerMultiplier, TOWER_ROWS } from "./tower-logic.js";
import { Chat } from "./chat.js";

const $ = (sel) => document.querySelector(sel);

// In BACKEND mode, holds the signed-in account; null until sign-in.
let account = null;
const SOL = 1_000_000_000;
const defaultBet = (game) =>
  ({
    dice: { target: 50, direction: "under" },
    limbo: { target: 2 },
    coinflip: { call: "heads" },
    wheel: {},
  })[game] ?? {};

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
      connected = null;
      account = null;
      api.clearToken();
      walletBtn.textContent = "Connect Wallet";
      walletInfo.textContent = "";
      $("#account-row").classList.add("hidden");
      $("#bet-btn").textContent = "Place demo bet";
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
      $("#bet-btn").textContent = "Place bet";
      walletInfo.textContent = `signed in (${CLUSTER})`;
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

// ---- Games grid -------------------------------------------------------------
const grid = $("#games-grid");
for (const g of GAME_CATALOG) {
  const card = document.createElement("button");
  card.className = "game-card" + (g.playable ? "" : " soon");
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

const RICH_GAMES = new Set(["dice", "tower"]); // games with a full interactive UI (more coming)

function mountGame(id) {
  const view = $("#game-view");
  view.innerHTML = "";
  const amountLabel = BACKEND_ENABLED ? "Bet (SOL)" : "Bet";
  if (id === "dice") createDiceGame(view, { onRoll: diceOnRoll, amountLabel });
  else if (id === "tower") {
    createTowerGame(view, {
      onStart: towerOnStart,
      onReveal: towerOnReveal,
      onCashout: towerOnCashout,
      amountLabel,
    });
  }
}

function selectGame(id) {
  currentGame = id;
  $("#panel-title").textContent = GAME_CATALOG.find((g) => g.id === id).name;
  $("#bet-controls").dataset.game = id;
  const rich = RICH_GAMES.has(id);
  $("#game-view").classList.toggle("hidden", !rich);
  $("#bet-btn").classList.toggle("hidden", rich); // rich games have their own roll button
  const sf = $("#stake-field");
  if (sf) sf.classList.toggle("hidden", rich); // rich games have their own amount field
  if (rich) mountGame(id);
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

$("#bet-btn").addEventListener("click", async () => {
  if (BACKEND_ENABLED) {
    if (!account) {
      logResult("Connect your wallet to sign in first.");
      return;
    }
    const stakeSol = parseFloat($("#stake-input").value);
    if (!(stakeSol > 0)) {
      logResult("Enter a stake amount.");
      return;
    }
    try {
      const out = await api.bet(currentGame, defaultBet(currentGame), Math.round(stakeSol * SOL));
      logResult(describeServer(out));
      updateBalance(out.balanceLamports);
      account.serverSeedHash = out.serverSeedHash;
      account.clientSeed = out.clientSeed;
      account.nonce = out.nonceUsed + 1;
      await refreshSeeds();
    } catch (e) {
      logResult("error: " + e.message);
    }
    return;
  }

  const ctx = { serverSeed, clientSeed, nonce };
  let res;
  try {
    if (currentGame === "dice") {
      res = await playDice(ctx, { target: 50, direction: "under" });
      logResult(`🎲 Dice rolled ${res.roll} — ${verdict(res)}`);
    } else if (currentGame === "limbo") {
      res = await playLimbo(ctx, { target: 2 });
      logResult(`🚀 Limbo hit ${res.result}x (target 2x) — ${verdict(res)}`);
    } else if (currentGame === "coinflip") {
      res = await playCoinflip(ctx, { call: "heads" });
      logResult(`🪙 Flip: ${res.flip} (called heads) — ${verdict(res)}`);
    } else if (currentGame === "wheel") {
      res = await playWheel(ctx);
      logResult(`🎡 Wheel segment ${res.segment} → ${res.multiplier}x — ${verdict(res)}`);
    }
    nonce++;
    await refreshSeeds();
  } catch (e) {
    logResult("error: " + e.message);
  }
});

function verdict(res) {
  return res.win ? `WIN x${res.multiplier.toFixed(2)}` : "no win";
}

// Describe a server-side bet result (BACKEND mode).
function describeServer(out) {
  const r = out.result;
  const o = r.outcome;
  let detail = r.game;
  if (r.game === "dice") detail = `🎲 Dice ${o.roll}`;
  else if (r.game === "limbo") detail = `🚀 Limbo ${o.result}x`;
  else if (r.game === "coinflip") detail = `🪙 ${o.flip}`;
  else if (r.game === "wheel") detail = `🎡 seg ${o.segment} (${o.multiplier}x)`;
  const money = r.win
    ? `WIN +${toSol(out.payoutLamports)}`
    : `-${toSol(out.stakeLamports)}`;
  return `${detail} — ${money} SOL · bal ${toSol(out.balanceLamports)}`;
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
      logResult(describeServer(out));
      updateBalance(out.balanceLamports);
      account.serverSeedHash = out.serverSeedHash;
      account.clientSeed = out.clientSeed;
      account.nonce = out.nonceUsed + 1;
      await refreshSeeds();
      return {
        roll: out.result.outcome.roll,
        win: out.result.win,
        multiplier: out.result.multiplier,
      };
    } catch (e) {
      logResult("error: " + e.message);
      return null;
    }
  }
  // demo mode
  const res = await playDice({ serverSeed, clientSeed, nonce }, { target, direction });
  logResult(
    `🎲 Dice rolled ${res.roll} — ${res.win ? "WIN x" + res.multiplier.toFixed(2) : "no win"}`,
  );
  nonce++;
  await refreshSeeds();
  return { roll: res.roll, win: res.win, multiplier: res.multiplier };
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

// ---- Chat -------------------------------------------------------------------
const chat = new Chat($("#chat-list"), $("#chat-input"), $("#chat-form"));
chat.startAmbient();

// init
selectGame("dice");

// Restore a previous backend session if one exists.
async function init() {
  if (BACKEND_ENABLED && api.hasToken()) {
    try {
      account = (await api.me()).account;
      $("#account-row").classList.remove("hidden");
      $("#bet-btn").textContent = "Place bet";
      $("#wallet-info").textContent = `signed in (${CLUSTER})`;
      updateBalance(account.balanceLamports);
    } catch {
      api.clearToken(); // stale/expired token
    }
  }
  await refreshSeeds();
}
init();
