// =============================================================================
// Chicken — road-crossing crash-ladder. A sidewalk on the left, then lanes (the
// count depends on difficulty); each lane carries the multiplier you lock in by
// reaching it. Press Go and the chicken leaps onto the next lane's spot; traffic
// keeps driving through the lanes ahead, crossed lanes get a barrier. Get caught
// and a car comes down that lane. Cash out any time.
// Presentation only; the app wires onStart/onStep/onCashout.
// =============================================================================
import { chickenMaxSteps, chickenMultiplier, chickenMaxMultiplier } from "./chicken-logic.js";

const DIFFS = ["easy", "medium", "hard", "expert"];
const SIDE = 90; // sidewalk width (px)
const LANE = 96; // lane width (px)
const HOP_MS = 460;
const CRASH_MS = 380;

const chickSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () =>
  !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Original artwork.
const CHICK_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <ellipse cx="30" cy="40" rx="18" ry="16" fill="#f5f2ea"/>
  <path d="M14 40 q-8 4 -2 12 q6 -2 9 -8z" fill="#e3ddcf"/>
  <circle cx="40" cy="24" r="11" fill="#f5f2ea"/>
  <path d="M35 14 q3 -7 6 -1 q3 -6 6 1 q-5 3 -12 0z" fill="#ff4d6d"/>
  <path d="M50 23 l8 3 -8 3z" fill="#ffb02e"/>
  <circle cx="44" cy="22" r="2" fill="#11131c"/>
  <path d="M27 55 v6 M35 55 v6" stroke="#ffb02e" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const carSvg = (body) => `<svg viewBox="0 0 56 84" aria-hidden="true">
  <rect x="4" y="4" width="48" height="76" rx="12" fill="${body}"/>
  <rect x="10" y="12" width="36" height="16" rx="4" fill="#0a0b10" opacity=".65"/>
  <rect x="10" y="52" width="36" height="12" rx="4" fill="#0a0b10" opacity=".5"/>
  <rect x="8" y="75" width="11" height="5" rx="2" fill="#ffce54"/>
  <rect x="37" y="75" width="11" height="5" rx="2" fill="#ffce54"/>
</svg>`;

const TRAFFIC_COLORS = ["#4aa3ff", "#35d07f", "#ffb02e", "#ff7ab6", "#9aa3b8", "#00e0b8"];

const laneX = (step) => (step === 0 ? SIDE / 2 : SIDE + (step - 1) * LANE + LANE / 2);

import { betField, wireBetFields } from "./bet-field.js";

export function createChickenGame(container, { onStart, onStep, onCashout, amountLabel = "Bet" }) {
  let difficulty = "medium";
  let session = null;
  let stepsTaken = 0;
  let busy = false;

  container.innerHTML = `
    <div class="chicken">
      <div class="chicken-controls">
        <div class="toggle chicken-diff">
          ${DIFFS.map((d) => `<button class="toggle-btn${d === "medium" ? " active" : ""}" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join("")}
        </div>
        <button id="ck-go" class="btn ck-go-btn" disabled>Go</button>
        <button id="ck-action" class="btn btn-primary big">Bet</button>
        ${betField("ck-amount", amountLabel)}
      </div>
      <div class="chicken-board">
        <div class="chicken-max">MAX PAYOUT <strong id="ck-max">x0</strong> · <span id="ck-lanes"></span></div>
        <div id="ck-viewport" class="road-viewport">
          <div id="ck-road" class="road"></div>
        </div>
        <div id="ck-status" class="chicken-status">Pick a difficulty and press Bet.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  wireBetFields(container);
  const viewport = $("#ck-viewport");
  const road = $("#ck-road");
  const actionBtn = $("#ck-action");
  const goBtn = $("#ck-go");
  const amountEl = $("#ck-amount");
  const statusEl = $("#ck-status");
  let chick = null;

  function updateHeader() {
    $("#ck-max").textContent = "x" + chickenMaxMultiplier(difficulty).toLocaleString();
    $("#ck-lanes").textContent = `${chickenMaxSteps(difficulty)} lanes`;
  }

  function buildRoad() {
    const lanes = chickenMaxSteps(difficulty);
    let html = `<div class="sidewalk"></div>`;
    for (let i = 1; i <= lanes; i++) {
      const color = TRAFFIC_COLORS[i % TRAFFIC_COLORS.length];
      // Stagger traffic so lanes don't move in lockstep.
      const dur = (1.6 + ((i * 37) % 9) / 10).toFixed(2);
      const delay = (-((i * 53) % 17) / 10).toFixed(2);
      html += `<div class="lane" data-step="${i}">
          <div class="traffic" style="animation-duration:${dur}s;animation-delay:${delay}s">${carSvg(color)}</div>
          <div class="car">${carSvg("#7c5cff")}</div>
          <div class="lane-barrier"></div>
          <div class="lane-hole"></div>
          <div class="lane-badge">${chickenMultiplier(difficulty, i)}x</div>
        </div>`;
    }
    html += `<div class="chick" id="ck-chick">
        <div class="chick-dust"></div>
        <div class="chick-body">${CHICK_SVG}</div>
      </div>`;
    road.innerHTML = html;
    road.style.width = SIDE + lanes * LANE + "px";
    chick = $("#ck-chick");
    chick.style.left = laneX(0) + "px";
    viewport.scrollLeft = 0;
    markLanes();
  }

  function markLanes() {
    road.querySelectorAll(".lane").forEach((ln) => {
      const step = Number(ln.dataset.step);
      ln.classList.toggle("passed", !!session && step <= stepsTaken);
      ln.classList.toggle("next", !!session && step === stepsTaken + 1);
    });
  }

  function follow(step) {
    const left = Math.max(0, laneX(step) - viewport.clientWidth / 2);
    if (viewport.scrollTo) viewport.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
    else viewport.scrollLeft = left;
  }

  // Leap onto the target lane's spot: takeoff stretch, arc, landing squash + dust.
  async function leapTo(step) {
    chick.style.left = laneX(step) + "px";
    follow(step);
    if (reducedMotion()) return;
    const body = chick.querySelector(".chick-body");
    const dust = chick.querySelector(".chick-dust");
    body.classList.remove("leap");
    dust.classList.remove("puff");
    void body.offsetWidth; // restart animations
    body.classList.add("leap");
    await chickSleep(HOP_MS * 0.85);
    dust.classList.add("puff");
    await chickSleep(HOP_MS * 0.15);
  }

  function setDiffEnabled(on) {
    container.querySelectorAll(".chicken-diff .toggle-btn").forEach((b) => (b.disabled = !on));
  }

  function endGame() {
    session = null;
    stepsTaken = 0;
    goBtn.disabled = true;
    actionBtn.textContent = "Bet";
    setDiffEnabled(true);
  }

  container.querySelectorAll(".chicken-diff .toggle-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (session) return;
      difficulty = b.dataset.d;
      container.querySelectorAll(".chicken-diff .toggle-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      updateHeader();
      buildRoad();
    });
  });

  goBtn.addEventListener("click", async () => {
    if (!session || busy) return;
    busy = true;
    goBtn.disabled = true;
    actionBtn.disabled = true; // no cash-out mid-leap
    try {
      const r = await onStep(session.sessionId);
      if (!r) {
        goBtn.disabled = false;
        return;
      }
      if (r.bust) {
        const lane = road.querySelector(`.lane[data-step="${r.step + 1}"]`);
        lane?.classList.add("stopped"); // clear ambient traffic from the deadly lane
        await leapTo(r.step + 1);
        lane?.classList.add("crash");
        if (!reducedMotion()) await chickSleep(CRASH_MS);
        chick.classList.add("squashed");
        statusEl.textContent = `💥 Hit on lane ${r.step + 1}. Lost.`;
        endGame();
        return;
      }
      stepsTaken = r.stepsTaken;
      markLanes(); // barrier goes up, traffic stops in the landing lane
      await leapTo(stepsTaken);
      if (r.completed) {
        chick.classList.add("win");
        statusEl.textContent = `🏆 Crossed every lane! ${r.multiplier}x`;
        endGame();
      } else {
        actionBtn.textContent = `Cash Out ${r.multiplier}x`;
        statusEl.textContent = `Safe! Lane ${stepsTaken} · ${r.multiplier}x`;
        goBtn.disabled = false;
      }
    } finally {
      busy = false;
      actionBtn.disabled = false;
    }
  });

  actionBtn.addEventListener("click", async () => {
    if (busy) return;
    if (session) {
      if (stepsTaken === 0) {
        statusEl.textContent = "Take at least one step before cashing out.";
        return;
      }
      busy = true;
      try {
        const r = await onCashout(session.sessionId);
        if (r) {
          chick.classList.add("win");
          statusEl.textContent = `💰 Cashed out ${r.multiplier}x.`;
        }
        endGame();
      } finally {
        busy = false;
      }
      return;
    }
    const amount = parseFloat(amountEl.value) || 0;
    busy = true;
    actionBtn.disabled = true;
    try {
      const s = await onStart({ difficulty, amount });
      if (!s) return;
      session = s;
      stepsTaken = 0;
      setDiffEnabled(false);
      buildRoad();
      goBtn.disabled = false;
      actionBtn.textContent = "Cash Out";
      statusEl.textContent = "Press Go to leap a lane. Cash out any time.";
    } finally {
      busy = false;
      actionBtn.disabled = false;
    }
  });

  /** Resume an unfinished game: chicken stands on the lane it last reached. */
  function restore({ sessionId, difficulty: d, stepsTaken: steps, multiplier }) {
    difficulty = d;
    container.querySelectorAll(".chicken-diff .toggle-btn").forEach((x) =>
      x.classList.toggle("active", x.dataset.d === d));
    updateHeader();
    session = { sessionId };
    stepsTaken = steps;
    setDiffEnabled(false);
    buildRoad();
    chick.style.left = laneX(steps) + "px";
    markLanes();
    follow(steps);
    goBtn.disabled = false;
    actionBtn.textContent = steps > 0 ? `Cash Out ${multiplier}x` : "Cash Out";
    statusEl.textContent = steps > 0
      ? `Resumed on lane ${steps} · ${multiplier}x. Go on or cash out.`
      : "Resumed. Press Go to leap a lane.";
  }

  updateHeader();
  buildRoad();
  return { restore };
}
