// =============================================================================
// Crash — the multiplier curve climbs from 1.00× in real time and busts at the
// engine's bust point. Your auto cash-out is a line on the chart: if the curve
// crosses it before the bust, you're paid that multiplier.
// `onPlay({ cashOut }, amount)` returns { outcome: { bustAt }, win, afterReveal }.
// =============================================================================
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const GROWTH = Math.log(2) / 2.6; // 2× after ~2.6 s, like a classic crash curve
const MAX_RUN_MS = 9000;

export function createCrashGame(container, { onPlay, amountLabel = "Bet" }) {
  let cashOut = 2;
  let busy = false;
  const history = [];

  container.innerHTML = `
    <div class="cr">
      <div class="cr-controls">
        <label class="field"><span class="k">Auto cash out at</span>
          <input id="cr-cashout" type="number" step="0.01" min="1.01" value="2.00" /></label>
        <div class="cr-stats">
          <div><span class="k">Payout on win</span><strong id="cr-payout">—</strong></div>
        </div>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="cr-amount" type="number" step="0.001" min="0" value="0.001" /></label>
        <button id="cr-go" class="btn btn-primary big">Bet</button>
      </div>
      <div class="cr-stage" id="cr-stage">
        <svg id="cr-svg" class="cr-svg" viewBox="0 0 600 260" preserveAspectRatio="none">
          <defs><linearGradient id="cr-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#7c5cff" stop-opacity=".45"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></linearGradient></defs>
          <g id="cr-grid" class="cr-grid"></g>
          <line id="cr-line" class="cr-line" x1="0" x2="600" y1="0" y2="0"/>
          <path id="cr-area" class="cr-area" d=""/>
          <path id="cr-path" class="cr-path" d=""/>
          <circle id="cr-dot" class="cr-dot" r="5" cx="0" cy="260"/>
          <g id="cr-cash" class="cr-cash" style="display:none"><circle r="7"/><text y="-12">cashed out</text></g>
        </svg>
        <div class="cr-readout" id="cr-readout">1.00×</div>
        <div class="cr-status" id="cr-status">Set your auto cash-out and bet.</div>
        <div class="cr-hist" id="cr-hist"></div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const W = 600, H = 260, PAD = 10;
  const readout = $("#cr-readout");
  const path = $("#cr-path");
  const area = $("#cr-area");
  const dot = $("#cr-dot");
  const cashMark = $("#cr-cash");

  // Axes scale with the run: x = time, y = multiplier (linear, rescaled as it grows).
  let yMax = 2;
  let tMax = 4000;
  const xOf = (t) => PAD + (t / tMax) * (W - 2 * PAD);
  const yOf = (m) => H - PAD - ((m - 1) / (yMax - 1)) * (H - 2 * PAD);
  const mAt = (t) => Math.exp(GROWTH * (t / 1000));

  function drawGrid() {
    const g = $("#cr-grid");
    const steps = yMax <= 3 ? 0.5 : yMax <= 10 ? 1 : yMax <= 30 ? 5 : 10;
    let html = "";
    for (let m = 1 + steps; m < yMax; m += steps) {
      html += `<line x1="0" x2="${W}" y1="${yOf(m)}" y2="${yOf(m)}"/><text x="4" y="${yOf(m) - 3}">${m.toFixed(steps < 1 ? 1 : 0)}×</text>`;
    }
    g.innerHTML = html;
    const line = $("#cr-line");
    const y = yOf(cashOut);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.style.display = cashOut < yMax ? "" : "none";
  }

  function render() {
    const amt = parseFloat($("#cr-amount").value) || 0;
    $("#cr-payout").textContent = amt > 0 ? (amt * cashOut).toFixed(4) : "—";
    drawGrid();
  }
  $("#cr-cashout").addEventListener("input", () => {
    cashOut = Math.max(1.01, parseFloat($("#cr-cashout").value) || 1.01);
    render();
  });
  $("#cr-amount").addEventListener("input", render);

  function reset() {
    yMax = Math.max(2, cashOut * 1.15);
    tMax = 4000;
    path.setAttribute("d", "");
    area.setAttribute("d", "");
    dot.setAttribute("cx", xOf(0));
    dot.setAttribute("cy", yOf(1));
    cashMark.style.display = "none";
    $("#cr-stage").classList.remove("bust", "win");
    readout.className = "cr-readout";
    readout.textContent = "1.00×";
    drawGrid();
  }

  function run(bustAt, cashedAt) {
    const busts = Math.log(bustAt) / GROWTH * 1000; // ms until the bust point
    const speed = Math.max(1, busts / MAX_RUN_MS); // long runs play faster
    const pts = [];
    let cashed = false;
    const finish = () => {
      const cx = xOf(busts / speed), cy = yOf(bustAt);
      $("#cr-stage").classList.add(cashed ? "win" : "bust");
      readout.textContent = bustAt.toFixed(2) + "×";
      readout.classList.add("bust");
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", cy);
    };
    if (reducedMotion()) {
      yMax = Math.max(yMax, bustAt * 1.1);
      tMax = Math.max(4000, busts / speed * 1.1);
      drawGrid();
      const d = `M${xOf(0)} ${yOf(1)} L${xOf(busts / speed)} ${yOf(bustAt)}`;
      path.setAttribute("d", d);
      if (cashedAt) { cashed = true; placeCash(cashedAt, Math.log(cashedAt) / GROWTH * 1000 / speed); }
      finish();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(busts, (now - t0) * speed);
        const m = Math.min(bustAt, mAt(t));
        const shownT = t / speed;
        // Grow the axes smoothly so the curve never leaves the chart.
        if (m > yMax * 0.85) { yMax = m * 1.3; drawGrid(); }
        if (shownT > tMax * 0.85) { tMax = shownT * 1.3; drawGrid(); }
        pts.push([shownT, m]);
        const d = pts.map(([pt, pm], i) => `${i ? "L" : "M"}${xOf(pt).toFixed(1)} ${yOf(pm).toFixed(1)}`).join(" ");
        path.setAttribute("d", d);
        area.setAttribute("d", `${d} L${xOf(shownT).toFixed(1)} ${H - PAD} L${xOf(0)} ${H - PAD} Z`);
        dot.setAttribute("cx", xOf(shownT));
        dot.setAttribute("cy", yOf(m));
        readout.textContent = m.toFixed(2) + "×";
        if (cashedAt && !cashed && m >= cashedAt) {
          cashed = true;
          placeCash(cashedAt, shownT);
          readout.classList.add("cashed");
        }
        if (t < busts) requestAnimationFrame(frame);
        else { finish(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }
  function placeCash(m, shownT) {
    cashMark.style.display = "";
    cashMark.setAttribute("transform", `translate(${xOf(shownT)} ${yOf(m)})`);
    cashMark.querySelector("text").textContent = `cashed out ${m.toFixed(2)}×`;
  }

  $("#cr-go").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#cr-go");
    btn.disabled = true;
    btn.textContent = "Running…";
    try {
      const amount = parseFloat($("#cr-amount").value) || 0;
      const res = await onPlay({ cashOut }, amount);
      if (!res) return;
      reset();
      $("#cr-status").textContent = `Auto cash-out at ${cashOut.toFixed(2)}×…`;
      const bustAt = res.outcome.bustAt;
      await run(bustAt, res.win ? cashOut : null);
      $("#cr-status").textContent = res.win
        ? `💥 Busted at ${bustAt.toFixed(2)}× — you cashed out at ${cashOut.toFixed(2)}× first.`
        : `💥 Busted at ${bustAt.toFixed(2)}× before your ${cashOut.toFixed(2)}×.`;
      history.unshift({ bustAt, win: res.win });
      if (history.length > 10) history.pop();
      $("#cr-hist").innerHTML = history.map((h) => `<span class="${h.win ? "win" : "lose"}">${h.bustAt.toFixed(2)}×</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = "Bet";
    }
  });

  render();
  reset();
  return {};
}
