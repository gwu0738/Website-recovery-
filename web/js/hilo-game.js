// =============================================================================
// HiLo — a card is dealt face up; call the next one Higher-or-same or
// Lower-or-same. Each right call multiplies your stake; the revealed card
// becomes the new base; cash out whenever you like. A wrong call loses the
// stake. Session game: onStart({ amount }) -> { sessionId, base }
//   onGuess(sessionId, guess) -> { card, win, bust, multiplier, nextBase }
//   onCashout(sessionId) -> { multiplier }
// =============================================================================
import { HOUSE_EDGE } from "./config.js";
import { hiloChance } from "./games.js";

const RANK_LABEL = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["♠", "♥", "♦", "♣"];
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const floor2 = (x) => Math.floor(x * 100) / 100;
const multFor = (base, guess) => floor2((1 / hiloChance(base, guess)) * (1 - HOUSE_EDGE));

function cardHtml(card, faceUp) {
  const red = card && (card.suit === 1 || card.suit === 2);
  return `<div class="card ${faceUp ? "up" : ""}">
    <div class="card-back"></div>
    <div class="card-front ${red ? "red" : ""}">${card ? `<span class="card-rank">${RANK_LABEL[card.rank]}</span><span class="card-suit">${SUITS[card.suit]}</span>` : ""}</div>
  </div>`;
}

export function createHiLoGame(container, { onStart, onGuess, onCashout, amountLabel = "Bet" }) {
  let session = null;
  let base = null; // { rank, suit }
  let multiplier = 1;
  let busy = false;
  let streak = [];

  container.innerHTML = `
    <div class="hl">
      <div class="hl-controls">
        <button id="hl-higher" class="btn hl-guess" disabled>Higher or same<small id="hl-hi-odds"></small></button>
        <button id="hl-lower" class="btn hl-guess" disabled>Lower or same<small id="hl-lo-odds"></small></button>
        <div class="hl-stats"><div><span class="k">Current</span><strong id="hl-mult">1.00×</strong></div>
          <div><span class="k">Right calls</span><strong id="hl-streak">0</strong></div></div>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="hl-amount" type="number" step="0.001" min="0" value="0.001" /></label>
        <button id="hl-action" class="btn btn-primary big">Deal</button>
      </div>
      <div class="hl-stage">
        <div class="hl-table">
          <div class="hl-slot" id="hl-base">${cardHtml(null, false)}</div>
          <div class="hl-arrow">→</div>
          <div class="hl-slot" id="hl-next">${cardHtml(null, false)}</div>
        </div>
        <div class="hl-history" id="hl-history"></div>
        <div class="hl-status" id="hl-status">Deal a card to start.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const actionBtn = $("#hl-action");
  const hi = $("#hl-higher"), lo = $("#hl-lower");

  function renderOdds() {
    if (!base) { hi.disabled = lo.disabled = true; return; }
    const pH = hiloChance(base.rank, "higherOrSame"), pL = hiloChance(base.rank, "lowerOrSame");
    $("#hl-hi-odds").textContent = `${(pH * 100).toFixed(1)}% · ×${multFor(base.rank, "higherOrSame").toFixed(2)}`;
    $("#hl-lo-odds").textContent = `${(pL * 100).toFixed(1)}% · ×${multFor(base.rank, "lowerOrSame").toFixed(2)}`;
    hi.disabled = lo.disabled = busy || !session;
    $("#hl-mult").textContent = multiplier.toFixed(2) + "×";
    $("#hl-streak").textContent = streak.filter((x) => x.win).length;
  }

  function setBase(card) {
    base = card;
    $("#hl-base").innerHTML = cardHtml(card, true);
    $("#hl-next").innerHTML = cardHtml(null, false);
  }

  async function revealNext(card) {
    const slot = $("#hl-next");
    slot.innerHTML = cardHtml(card, false);
    await new Promise((r) => setTimeout(r, 30));
    slot.querySelector(".card").classList.add("up");
    if (!reducedMotion()) await new Promise((r) => setTimeout(r, 650));
  }

  async function guess(g) {
    if (!session || busy) return;
    busy = true;
    renderOdds();
    try {
      const r = await onGuess(session.sessionId, g);
      if (!r) return;
      await revealNext(r.card);
      streak.push({ from: base, to: r.card, win: !r.bust });
      $("#hl-history").innerHTML = streak.slice(-8).map((s) =>
        `<span class="${s.win ? "win" : "lose"}">${RANK_LABEL[s.from.rank]}→${RANK_LABEL[s.to.rank]}</span>`).join("");
      if (r.bust) {
        $("#hl-status").textContent = `✗ ${RANK_LABEL[r.card.rank]} — wrong call. Lost.`;
        endGame();
        return;
      }
      multiplier = r.multiplier;
      $("#hl-status").textContent = `✓ ${RANK_LABEL[r.card.rank]} — right! ×${multiplier.toFixed(2)}. Call again or cash out.`;
      actionBtn.textContent = `Cash Out ×${multiplier.toFixed(2)}`;
      if (!reducedMotion()) await new Promise((r2) => setTimeout(r2, 350));
      setBase(r.card);
    } finally {
      busy = false;
      renderOdds();
    }
  }
  hi.addEventListener("click", () => guess("higherOrSame"));
  lo.addEventListener("click", () => guess("lowerOrSame"));

  function endGame() {
    session = null;
    multiplier = 1;
    actionBtn.textContent = "Deal";
    renderOdds();
    hi.disabled = lo.disabled = true;
  }

  actionBtn.addEventListener("click", async () => {
    if (busy) return;
    if (session) {
      if (streak.length === 0) { $("#hl-status").textContent = "Make at least one call before cashing out."; return; }
      busy = true;
      try {
        const r = await onCashout(session.sessionId);
        if (r) $("#hl-status").textContent = `💰 Cashed out ×${r.multiplier.toFixed(2)}.`;
        endGame();
      } finally { busy = false; }
      return;
    }
    busy = true;
    actionBtn.disabled = true;
    try {
      const amount = parseFloat($("#hl-amount").value) || 0;
      const s = await onStart({ amount });
      if (!s) return;
      session = s;
      streak = [];
      multiplier = 1;
      $("#hl-history").innerHTML = "";
      setBase(s.base);
      actionBtn.textContent = "Cash Out";
      $("#hl-status").textContent = `Base card ${RANK_LABEL[s.base.rank]}. Higher or lower?`;
    } finally {
      busy = false;
      actionBtn.disabled = false;
      renderOdds();
    }
  });

  /** Resume an unfinished game: the current base card and multiplier. */
  function restore({ sessionId, base: b, multiplier: m, correct }) {
    session = { sessionId };
    streak = Array.from({ length: correct }, () => ({ from: b, to: b, win: true }));
    multiplier = m;
    setBase(b);
    actionBtn.textContent = m > 1 ? `Cash Out ×${m.toFixed(2)}` : "Cash Out";
    $("#hl-status").textContent = `Resumed at ×${m.toFixed(2)}. Base card ${RANK_LABEL[b.rank]} — higher or lower?`;
    renderOdds();
  }

  renderOdds();
  return { restore };
}
