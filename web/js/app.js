// =============================================================================
// App bootstrap — wires branding, socials, games grid, the playable bet panel,
// wallet connect, and the live chat together.
// =============================================================================
import { BRAND, SOCIALS, HOUSE_EDGE, CLUSTER } from "./config.js";
import { randomHex, hashServerSeed, verifyCommitment } from "./fairness.js";
import { playDice, playLimbo, playCoinflip, playWheel, GAME_CATALOG } from "./games.js";
import { connect, disconnect, getBalanceSol, getProvider } from "./wallet.js";
import { Chat } from "./chat.js";

const $ = (sel) => document.querySelector(sel);

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
      walletBtn.textContent = "Connect Wallet";
      walletInfo.textContent = "";
      return;
    }
    if (!getProvider()) {
      walletInfo.textContent = "Phantom not detected — install phantom.app";
      return;
    }
    const addr = await connect();
    connected = addr;
    walletBtn.textContent = addr.slice(0, 4) + "…" + addr.slice(-4);
    walletInfo.textContent = "checking balance…";
    try {
      const bal = await getBalanceSol(addr);
      walletInfo.textContent = `${bal.toFixed(4)} SOL (${CLUSTER})`;
    } catch (e) {
      walletInfo.textContent = `connected — balance read failed (${CLUSTER} RPC)`;
    }
  } catch (e) {
    walletInfo.textContent = e.message || "connection failed";
  }
});

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
  $("#seed-hash").textContent = await hashServerSeed(serverSeed);
  $("#seed-client").textContent = clientSeed;
  $("#seed-nonce").textContent = nonce;
}

function selectGame(id) {
  currentGame = id;
  $("#panel-title").textContent = GAME_CATALOG.find((g) => g.id === id).name;
  document.querySelectorAll(".game-card").forEach((c) => c.classList.remove("active"));
  $("#bet-controls").dataset.game = id;
}

$("#new-seed").addEventListener("click", async () => {
  serverSeed = randomHex(32);
  clientSeed = randomHex(8);
  nonce = 1;
  await refreshSeeds();
  logResult("↻ New seed pair generated. Old server seed is now revealable.");
});

$("#bet-btn").addEventListener("click", async () => {
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

// ---- Chat -------------------------------------------------------------------
const chat = new Chat($("#chat-list"), $("#chat-input"), $("#chat-form"));
chat.startAmbient();

// init
selectGame("dice");
refreshSeeds();
