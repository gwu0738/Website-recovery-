// =============================================================================
// Roulette — a real table and a real wheel.
//
//   Right:  a European wheel (37 pockets in true wheel order) that spins while
//           the ball orbits the other way, slows, and drops into the pocket
//           the provably-fair engine chose. Below it, the betting table.
//   Left:   chip value, Spin / Undo / Clear, total staked, last results.
//
// Presentation only. The spin itself comes from `onSpin(chips)`, which the app
// wires to the in-browser engine (demo) or the backend (real balance). The
// result is known before the animation; the balance update is held back via
// `afterSpin()` until the ball lands, so nothing is spoiled.
// =============================================================================
import {
  WHEEL_ORDER,
  ROULETTE_MAX_CHIPS,
  pocketColor,
  roulettePayoutMultiplier,
  rouletteBetLabel,
} from "./roulette-logic.js";

const STEP = 360 / 37;
const SPIN_MS = 4600;
const WHEEL_TURNS = 4;
const BALL_TURNS = 7;
const RIM_R = 93; // ball orbit radius while spinning (% of the wheel radius; the rim track)
const POCKET_R = 74; // where the ball rests: the middle of the pocket ring
const COLORS = { red: "#d83a52", black: "#1e2130", green: "#1f9d6b" };
const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const reduced = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t) => 1 - Math.pow(1 - t, 3.2);
const fmt = (x) => (Math.round(x * 1e6) / 1e6).toString();

// ---- the wheel as SVG ---------------------------------------------------------
function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function wedge(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
}
function wheelSvg() {
  const c = 200;
  let pockets = "";
  let labels = "";
  let dividers = "";
  WHEEL_ORDER.forEach((n, i) => {
    const a0 = i * STEP;
    const a1 = (i + 1) * STEP;
    const mid = a0 + STEP / 2;
    pockets += `<path d="${wedge(c, c, 118, 176, a0, a1)}" fill="${COLORS[pocketColor(n)]}" data-pocket="${n}"/>`;
    const [lx, ly] = polar(c, c, 158, mid);
    labels += `<text x="${lx}" y="${ly}" transform="rotate(${mid} ${lx} ${ly})" class="rl-num">${n}</text>`;
    const [dx0, dy0] = polar(c, c, 118, a0);
    const [dx1, dy1] = polar(c, c, 176, a0);
    dividers += `<line x1="${dx0}" y1="${dy0}" x2="${dx1}" y2="${dy1}"/>`;
  });
  return `<svg viewBox="0 0 400 400" class="rl-wheel-svg" aria-hidden="true">
    <defs>
      <radialGradient id="rl-cone" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#3a2f12"/><stop offset=".55" stop-color="#8a6a26"/><stop offset="1" stop-color="#5a4318"/>
      </radialGradient>
      <radialGradient id="rl-rim" cx="50%" cy="50%" r="50%">
        <stop offset=".86" stop-color="#2a2412"/><stop offset=".93" stop-color="#c9a24a"/><stop offset="1" stop-color="#6b5420"/>
      </radialGradient>
    </defs>
    <circle cx="200" cy="200" r="196" fill="url(#rl-rim)"/>
    <circle cx="200" cy="200" r="178" fill="#0c0d14"/>
    <g>${pockets}</g>
    <g class="rl-dividers">${dividers}</g>
    <g>${labels}</g>
    <circle cx="200" cy="200" r="118" fill="url(#rl-cone)" stroke="#c9a24a" stroke-width="2"/>
    <g class="rl-spokes" stroke="#e8d18a" stroke-width="5" stroke-linecap="round">
      <line x1="200" y1="110" x2="200" y2="290"/><line x1="110" y1="200" x2="290" y2="200"/>
      <line x1="136" y1="136" x2="264" y2="264"/><line x1="264" y1="136" x2="136" y2="264"/>
    </g>
    <circle cx="200" cy="200" r="22" fill="#e8d18a"/>
    <circle cx="200" cy="200" r="10" fill="#8a6a26"/>
  </svg>`;
}

// ---- the table ----------------------------------------------------------------
const key = (bet) => JSON.stringify(bet);
function tableHtml() {
  const cell = (bet, text, cls = "", style = "") =>
    `<button type="button" class="rl-cell ${cls}" data-bet='${JSON.stringify(bet)}' style="${style}">
       <span class="rl-cell-txt">${text}</span></button>`;
  let h = `<div class="rl-table">`;
  h += cell({ type: "straight", number: 0 }, "0", "green zero", "grid-row: 1 / span 3; grid-column: 1");
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 12; col++) {
      const n = col * 3 + (3 - row);
      h += cell({ type: "straight", number: n }, n, RED_SET.has(n) ? "red" : "black",
        `grid-row:${row + 1}; grid-column:${col + 2}`);
    }
    h += cell({ type: "column", column: 3 - row }, "2:1", "outside", `grid-row:${row + 1}; grid-column:14`);
  }
  [1, 2, 3].forEach((d) =>
    (h += cell({ type: "dozen", dozen: d }, ["1st 12", "2nd 12", "3rd 12"][d - 1], "outside",
      `grid-row:4; grid-column:${2 + (d - 1) * 4} / span 4`)));
  const even = [
    [{ type: "low" }, "1-18"], [{ type: "even" }, "EVEN"], [{ type: "red" }, "RED", "red"],
    [{ type: "black" }, "BLACK", "black"], [{ type: "odd" }, "ODD"], [{ type: "high" }, "19-36"],
  ];
  even.forEach(([bet, text, cls], i) =>
    (h += cell(bet, text, "outside " + (cls ?? ""), `grid-row:5; grid-column:${2 + i * 2} / span 2`)));
  return h + `</div>`;
}

export function createRouletteGame(container, { onSpin, amountLabel = "Bet" }) {
  const chips = new Map(); // key -> { bet, amount }
  const order = []; // keys in placement order, for Undo
  let spinning = false;
  let wheelDeg = 0; // current rotor rotation
  let ballDeg = 0;
  const history = [];

  container.innerHTML = `
    <div class="rl">
      <div class="rl-left">
        <label class="field"><span class="k">Chip · ${amountLabel}</span>
          <input id="rl-chip" type="number" step="0.001" min="0" value="0.001" /></label>
        <div class="rl-quick">
          <button type="button" class="btn btn-ghost rl-small" data-mul="0.5">½</button>
          <button type="button" class="btn btn-ghost rl-small" data-mul="2">2×</button>
          <button type="button" class="btn btn-ghost rl-small" data-mul="10">10×</button>
        </div>
        <div class="rl-total"><span class="k">Total staked</span><strong id="rl-total">0</strong>
          <span class="k" id="rl-count">no chips</span></div>
        <button id="rl-spin" class="btn btn-primary big" disabled>Spin</button>
        <div class="rl-row">
          <button id="rl-undo" class="btn btn-ghost" type="button" disabled>Undo</button>
          <button id="rl-clear" class="btn btn-ghost" type="button" disabled>Clear</button>
        </div>
        <div class="rl-hist"><span class="k">Last results</span><div id="rl-hist" class="rl-hist-list"></div></div>
      </div>
      <div class="rl-right">
        <div class="rl-wheel-wrap">
          <div class="rl-pointer"></div>
          <div id="rl-rotor" class="rl-rotor">${wheelSvg()}</div>
          <div id="rl-ball-orbit" class="rl-ball-orbit"><div id="rl-ball" class="rl-ball"></div></div>
          <div id="rl-result" class="rl-result"><span class="rl-result-num">·</span><span class="rl-result-sub">place your chips</span></div>
        </div>
        ${tableHtml()}
        <div id="rl-status" class="rl-status">Click the table to place chips, then Spin.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const chipEl = $("#rl-chip");
  const spinBtn = $("#rl-spin");
  const undoBtn = $("#rl-undo");
  const clearBtn = $("#rl-clear");
  const statusEl = $("#rl-status");
  const rotor = $("#rl-rotor");
  const orbit = $("#rl-ball-orbit");
  const ball = $("#rl-ball");
  const resultEl = $("#rl-result");

  const chipValue = () => Math.max(0, parseFloat(chipEl.value) || 0);
  const total = () => [...chips.values()].reduce((s, c) => s + c.amount, 0);

  const wheelWrap = $(".rl-wheel-wrap");
  function setBall(deg, rPct) {
    const px = ((wheelWrap.clientWidth || 340) / 2) * (rPct / 100);
    orbit.style.transform = `rotate(${deg}deg)`;
    ball.style.transform = `translate(-50%, -50%) translateY(-${px}px)`;
  }
  setBall(0, POCKET_R);
  window.addEventListener("resize", () => !spinning && setBall(ballDeg, POCKET_R));

  function renderChips() {
    container.querySelectorAll(".rl-cell").forEach((cell) => {
      const k = cell.dataset.bet;
      const c = chips.get(k);
      let badge = cell.querySelector(".rl-chip");
      if (c) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "rl-chip";
          cell.appendChild(badge);
        }
        badge.textContent = fmt(c.amount);
      } else if (badge) badge.remove();
    });
    const t = total();
    $("#rl-total").textContent = fmt(t);
    $("#rl-count").textContent = chips.size ? `${chips.size} chip${chips.size > 1 ? "s" : ""}` : "no chips";
    spinBtn.disabled = spinning || t <= 0;
    undoBtn.disabled = spinning || order.length === 0;
    clearBtn.disabled = spinning || chips.size === 0;
  }

  function place(bet) {
    if (spinning) return;
    const v = chipValue();
    if (!(v > 0)) {
      statusEl.textContent = "Set a chip value first.";
      return;
    }
    const k = key(bet);
    const existing = chips.get(k);
    if (!existing && chips.size >= ROULETTE_MAX_CHIPS) {
      statusEl.textContent = `At most ${ROULETTE_MAX_CHIPS} spots per spin.`;
      return;
    }
    chips.set(k, { bet, amount: (existing?.amount ?? 0) + v });
    order.push(k);
    statusEl.textContent = `${fmt(v)} on ${rouletteBetLabel(bet)} · pays ${roulettePayoutMultiplier(bet)}× on a hit`;
    clearResultMarks();
    renderChips();
  }

  container.querySelectorAll(".rl-cell").forEach((cell) => {
    cell.addEventListener("click", () => place(JSON.parse(cell.dataset.bet)));
  });

  undoBtn.addEventListener("click", () => {
    if (spinning || !order.length) return;
    const k = order.pop();
    const c = chips.get(k);
    if (!c) return;
    // Remove the most recent chip value placed on that spot.
    const v = chipValue() || c.amount;
    const left = Math.round((c.amount - v) * 1e9) / 1e9;
    if (left > 0) chips.set(k, { bet: c.bet, amount: left });
    else chips.delete(k);
    renderChips();
  });
  clearBtn.addEventListener("click", () => {
    if (spinning) return;
    chips.clear();
    order.length = 0;
    clearResultMarks();
    renderChips();
  });
  container.querySelectorAll(".rl-quick .btn").forEach((b) =>
    b.addEventListener("click", () => {
      chipEl.value = fmt(Math.max(0, chipValue() * Number(b.dataset.mul)));
    }));

  function clearResultMarks() {
    container.querySelectorAll(".rl-cell.hit").forEach((c) => c.classList.remove("hit"));
  }

  function showResult(pocket, text, cls) {
    const color = pocketColor(pocket);
    resultEl.querySelector(".rl-result-num").textContent = pocket;
    resultEl.querySelector(".rl-result-sub").textContent = text;
    resultEl.className = `rl-result show ${color} ${cls}`;
    const cell = container.querySelector(`.rl-cell[data-bet='${JSON.stringify({ type: "straight", number: pocket })}']`);
    cell?.classList.add("hit");
    history.unshift(pocket);
    if (history.length > 14) history.pop();
    $("#rl-hist").innerHTML = history
      .map((p) => `<span class="rl-hist-chip ${pocketColor(p)}">${p}</span>`).join("");
  }

  /** Spin the wheel one way and the ball the other; both stop with `pocket` under the pointer. */
  function animateTo(pocket) {
    const idx = WHEEL_ORDER.indexOf(pocket);
    const pocketAngle = (idx + 0.5) * STEP; // where this pocket sits on the unrotated wheel
    // Rotor must end at an angle where pocketAngle + rotor ≡ 0 (pocket under the top pointer).
    const targetMod = (360 - pocketAngle) % 360;
    const curMod = ((wheelDeg % 360) + 360) % 360;
    const delta = (targetMod - curMod + 360) % 360;
    const wheelEnd = wheelDeg + WHEEL_TURNS * 360 + delta;
    // Ball orbits the opposite way and ends exactly at the pointer (0°).
    const ballCur = ((ballDeg % 360) + 360) % 360;
    const ballEnd = ballDeg - BALL_TURNS * 360 - ballCur;
    const wheelStart = wheelDeg;
    const ballStart = ballDeg;

    if (reduced()) {
      wheelDeg = wheelEnd;
      ballDeg = ballEnd;
      rotor.style.transform = `rotate(${wheelDeg}deg)`;
      setBall(ballDeg, POCKET_R);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / SPIN_MS);
        const e = easeOut(t);
        wheelDeg = wheelStart + (wheelEnd - wheelStart) * e;
        ballDeg = ballStart + (ballEnd - ballStart) * e;
        // The ball rides the rim, then drops into the pocket ring over the last stretch.
        const drop = t < 0.72 ? 0 : (t - 0.72) / 0.28;
        const r = RIM_R - (RIM_R - POCKET_R) * drop + (drop > 0 && drop < 1 ? Math.sin(drop * Math.PI * 3) * 1.5 * (1 - drop) : 0);
        rotor.style.transform = `rotate(${wheelDeg}deg)`;
        setBall(ballDeg, r);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  spinBtn.addEventListener("click", async () => {
    if (spinning || total() <= 0) return;
    spinning = true;
    renderChips();
    spinBtn.textContent = "Spinning…";
    resultEl.className = "rl-result";
    clearResultMarks();
    container.classList.add("spinning");
    try {
      const staked = total();
      const res = await onSpin({ chips: [...chips.values()], total: staked });
      if (!res) return;
      statusEl.textContent = "No more bets…";
      await animateTo(res.pocket);
      const net = res.payout - staked;
      const color = pocketColor(res.pocket);
      if (res.payout > 0) {
        showResult(res.pocket, `${color} · returned ${fmt(res.payout)}`, net >= 0 ? "win" : "part");
        statusEl.textContent = net >= 0
          ? `🎯 ${res.pocket} ${color} — won ${fmt(res.payout)} (net +${fmt(net)})`
          : `🎯 ${res.pocket} ${color} — returned ${fmt(res.payout)} (net ${fmt(net)})`;
      } else {
        showResult(res.pocket, `${color} · no hit`, "lose");
        statusEl.textContent = `🎯 ${res.pocket} ${color} — lost ${fmt(staked)}`;
      }
      res.afterSpin?.();
    } finally {
      spinning = false;
      container.classList.remove("spinning");
      spinBtn.textContent = "Spin";
      renderChips();
    }
  });

  renderChips();
  return { place };
}
