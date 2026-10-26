// =============================================================================
// Wallet panel (BACKEND mode): real-SOL deposits and withdrawals.
//
// Deposit: Phantom sends SOL to the house address; the signature goes to the
// server, which verifies it on-chain and credits exactly what arrived.
// Withdraw: the server checks the rules (balance, bonus wagering, house
// solvency) and sends SOL from the house wallet to the signed-in wallet.
// =============================================================================
import { api } from "./api.js";
import { getActiveCluster, LAMPORTS_PER_SOL, toSol } from "./config.js";
import { explorerTxUrl, sendDeposit } from "./wallet.js";

const short = (s) => (s ? s.slice(0, 4) + "…" + s.slice(-4) : "—");
const escapeAttr = (s) => String(s).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);

export function createWalletPanel(container, { getProvider, getAddress, onBalance, log }) {
  container.innerHTML = `
    <div class="wp">
      <div class="wp-head">
        <strong>Wallet</strong>
        <span class="wp-cluster" id="wp-cluster"></span>
      </div>
      <div class="wp-row"><span class="k">Deposit address</span>
        <code id="wp-house" class="wp-house">—</code>
        <button id="wp-copy" class="btn btn-ghost wp-small" type="button">Copy</button></div>
      <div class="wp-row"><span class="k">Balance</span><strong id="wp-bal">—</strong>
        <span id="wp-wager" class="wp-wager"></span></div>
      <div class="wp-forms">
        <form id="wp-dep-form" class="wp-form">
          <label class="k" for="wp-dep">Deposit (SOL)</label>
          <div class="wp-inline"><input id="wp-dep" type="number" min="0" step="0.001" value="0.05" />
          <button class="btn btn-primary" type="submit">Deposit</button></div>
        </form>
        <form id="wp-wd-form" class="wp-form">
          <label class="k" for="wp-wd">Withdraw (SOL)</label>
          <div class="wp-inline"><input id="wp-wd" type="number" min="0" step="0.001" value="0.01" />
          <button class="btn btn-ghost" type="submit">Withdraw</button></div>
        </form>
      </div>
      <div id="wp-status" class="wp-status" role="status"></div>
      <div class="wp-hist"><span class="k">Recent</span><ul id="wp-list"></ul></div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  let houseAddress = null;
  let busy = false;

  const status = (msg, kind = "") => {
    $("#wp-status").textContent = msg;
    $("#wp-status").className = "wp-status " + kind;
  };

  async function refresh() {
    try {
      const w = await api.wallet();
      houseAddress = w.houseAddress;
      $("#wp-cluster").textContent = w.cluster;
      $("#wp-house").textContent = houseAddress ? houseAddress : "not configured on this server";
      $("#wp-bal").textContent = toSol(w.balanceLamports) + " SOL";
      $("#wp-wager").textContent = w.wagerRemaining > 0
        ? `· wager ${toSol(w.wagerRemaining)} SOL more to unlock withdrawals`
        : "";
      onBalance(w.balanceLamports);
      const items = [
        ...w.deposits.map((d) => ({ t: d.createdAt, label: `+${toSol(d.lamports)} deposit`, sig: d.signature, cls: "in" })),
        ...w.withdrawals.map((x) => ({ t: x.createdAt, label: `−${toSol(x.lamports)} withdraw · ${x.status}`, sig: x.signature, cls: x.status })),
      ].sort((a, b) => b.t - a.t).slice(0, 8);
      $("#wp-list").innerHTML = items.length
        ? items.map((i) => `<li class="${i.cls}">${i.label}${i.sig
            ? ` <a href="${escapeAttr(explorerTxUrl(i.sig, getActiveCluster()))}" target="_blank" rel="noopener">${short(i.sig)}</a>`
            : ""}</li>`).join("")
        : `<li class="empty">No deposits or withdrawals yet.</li>`;
    } catch (e) {
      status(e.message, "bad");
    }
  }

  $("#wp-copy").addEventListener("click", async () => {
    if (!houseAddress) return;
    try {
      await navigator.clipboard.writeText(houseAddress);
      status("Deposit address copied.");
    } catch {
      status("Copy failed — select the address manually.", "bad");
    }
  });

  $("#wp-dep-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const sol = parseFloat($("#wp-dep").value);
    if (!(sol > 0)) return status("Enter an amount to deposit.", "bad");
    if (!houseAddress) return status("Deposits aren't configured on this server.", "bad");
    busy = true;
    try {
      status("Approve the transfer in Phantom…");
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      const sig = await sendDeposit(getProvider(), getAddress(), houseAddress, lamports);
      status("Sent — verifying on-chain…");
      const r = await api.depositConfirm(sig);
      status(`Deposited ${toSol(r.creditedLamports)} SOL.`, "ok");
      log?.(`💰 Deposit +${toSol(r.creditedLamports)} SOL`);
      await refresh();
    } catch (err) {
      status(err.message || "Deposit failed", "bad");
    } finally {
      busy = false;
    }
  });

  $("#wp-wd-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const sol = parseFloat($("#wp-wd").value);
    if (!(sol > 0)) return status("Enter an amount to withdraw.", "bad");
    busy = true;
    try {
      status("Sending your withdrawal…");
      const r = await api.withdraw(Math.round(sol * LAMPORTS_PER_SOL));
      status(
        r.status === "sent"
          ? `Withdrew ${toSol(r.lamports)} SOL to your wallet.`
          : `Withdrawal is pending confirmation (${short(r.signature)}).`,
        r.status === "sent" ? "ok" : "",
      );
      log?.(`🏧 Withdraw −${toSol(r.lamports)} SOL · ${r.status}`);
      await refresh();
    } catch (err) {
      status(err.message || "Withdrawal failed", "bad");
    } finally {
      busy = false;
    }
  });

  refresh();
  return { refresh };
}
