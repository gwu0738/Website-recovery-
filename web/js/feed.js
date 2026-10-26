// =============================================================================
// Live Games / My Games panel under the game card.
// Backend mode: polls the server's recent settled bets and the player's own.
// No server: lists this browser's results.
// =============================================================================
import { toSol } from "./config.js";

const GAME_ICON = { dice: "🎲", limbo: "🚀", crash: "📈", coinflip: "🪙", wheel: "🎡", plinko: "🟣", roulette: "🎯", darts: "🎯", snakes: "🐍", keno: "🔮", mines: "💣", hilo: "🃏", tower: "🧗", chicken: "🐔" };
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

export function createFeed(container, { fetchRecent, fetchMine }) {
  let tab = "live";
  let timer = null;
  const local = [];

  container.innerHTML = `
    <div class="feed">
      <div class="feed-tabs">
        <button class="feed-tab active" data-tab="live">Live games</button>
        <button class="feed-tab" data-tab="mine">My games</button>
      </div>
      <table class="feed-table"><thead><tr><th>Game</th><th>Player</th><th>Bet</th><th>Multiplier</th><th>Payout</th><th></th></tr></thead>
        <tbody id="feed-body"><tr><td colspan="6" class="feed-empty">No games yet.</td></tr></tbody></table>
    </div>`;

  const body = container.querySelector("#feed-body");
  const row = (b) => `<tr class="${b.payoutLamports > 0 ? "win" : "lose"}">
      <td>${GAME_ICON[b.game] ?? ""} ${b.game}</td><td>${b.pubkey ?? "you"}</td>
      <td>${toSol(b.stakeLamports)}</td><td>${Number(b.multiplier).toFixed(2)}×</td>
      <td>${b.payoutLamports > 0 ? "+" + toSol(b.payoutLamports) : "−" + toSol(b.stakeLamports)}</td><td class="feed-ago">${ago(b.createdAt)}</td></tr>`;

  async function refresh() {
    let bets = [];
    try {
      if (tab === "live") bets = fetchRecent ? (await fetchRecent()).bets : local;
      else bets = fetchMine ? (await fetchMine()).bets : local;
    } catch { bets = []; }
    body.innerHTML = bets.length ? bets.slice(0, 25).map(row).join("") : `<tr><td colspan="6" class="feed-empty">No games yet.</td></tr>`;
  }
  container.querySelectorAll(".feed-tab").forEach((b) =>
    b.addEventListener("click", () => {
      tab = b.dataset.tab;
      container.querySelectorAll(".feed-tab").forEach((x) => x.classList.toggle("active", x === b));
      refresh();
    }));

  function start() {
    stop();
    refresh();
    if (fetchRecent) timer = setInterval(() => document.visibilityState === "visible" && refresh(), 8000);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  /** No-server mode: record a settled bet from this browser. */
  function push(b) {
    local.unshift({ ...b, createdAt: Date.now(), pubkey: "you" });
    if (local.length > 50) local.pop();
    refresh();
  }
  return { start, stop, refresh, push };
}
