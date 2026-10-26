// =============================================================================
// Wallet panel (BACKEND mode): real-SOL deposits and withdrawals.
//
// Deposit: Phantom sends SOL to the house address; the signature goes to the
// server, which verifies it on-chain and credits exactly what arrived.
// Withdraw: the server checks the rules (balance, bonus wagering, house
// solvency) and sends SOL from the house wallet to the signed-in wallet.
//
// Nobody loses a deposit:
//   - the signature is saved in this browser the moment Phantom returns it,
//     before we wait for confirmation; if the tab closes or the server is
//     briefly unreachable, the next visit retries crediting it;
//   - a deposit can also be credited by pasting its signature by hand;
//   - a transfer is refused up front if Phantom has switched to a different
//     account than the one signed in (the server only credits transfers from
//     the signed-in wallet, so that SOL would otherwise sit uncredited).
// =============================================================================
import { api } from "./api.js";
import { getActiveCluster, LAMPORTS_PER_SOL, toSol } from "./config.js";
import { activeAddress, explorerTxUrl, sendDeposit } from "./wallet.js";

const short = (s) => (s ? s.slice(0, 4) + "…" + s.slice(-4) : "—");
const escapeAttr = (s) => String(s).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const PENDING_KEY = "vanta_pending_deposits";

// ---- deposits awaiting credit, remembered per browser ------------------------
function loadPending() {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function savePending(list) {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable: the manual signature field still works */
  }
}
export function rememberDeposit(pubkey, signature, lamports) {
  const list = loadPending().filter((d) => d.signature !== signature);
  list.push({ pubkey, signature, lamports, t: Date.now() });
  savePending(list);
}
function forgetDeposit(signature) {
  savePending(loadPending().filter((d) => d.signature !== signature));
}

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
      <div id="wp-pending" class="wp-pending"></div>
      <details class="wp-recover">
        <summary>Sent a deposit that wasn't credited? Paste its transaction signature.</summary>
        <form id="wp-rec-form" class="wp-inline">
          <input id="wp-rec" type="text" placeholder="transaction signature" autocomplete="off" spellcheck="false" />
          <button class="btn btn-ghost" type="submit">Credit it</button>
        </form>
      </details>
      <div class="wp-hist"><span class="k">Recent</span><ul id="wp-list"></ul></div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  let houseAddress = null;
  let busy = false;

  const status = (msg, kind = "") => {
    $("#wp-status").textContent = msg;
    $("#wp-status").className = "wp-status " + kind;
  };

  function myPending() {
    const me = getAddress();
    return loadPending().filter((d) => d.pubkey === me);
  }

  function renderPending() {
    const list = myPending();
    $("#wp-pending").textContent = list.length
      ? `${list.length} deposit${list.length > 1 ? "s" : ""} awaiting credit (${list.map((d) => short(d.signature)).join(", ")}) — retrying automatically.`
      : "";
  }

  /** Credit a signature; returns true when it's settled (credited or already credited). */
  async function credit(signature, { quiet = false } = {}) {
    try {
      const r = await api.depositConfirm(signature);
      forgetDeposit(signature);
      status(`Deposited ${toSol(r.creditedLamports)} SOL.`, "ok");
      log?.(`💰 Deposit +${toSol(r.creditedLamports)} SOL`);
      onBalance(r.balanceLamports);
      return true;
    } catch (err) {
      if (/already credited/i.test(err.message || "")) {
        forgetDeposit(signature);
        if (!quiet) status("That deposit was already credited to your balance.", "ok");
        return true;
      }
      if (!quiet) status(err.message || "Couldn't credit that deposit", "bad");
      return false;
    }
  }

  /** Retry every remembered deposit for this wallet (e.g. after a closed tab). */
  async function retryPending() {
    let settled = 0;
    for (const d of myPending()) {
      if (await credit(d.signature, { quiet: true })) settled++;
    }
    renderPending();
    return settled;
  }

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
      renderPending();
      if (myPending().length && (await retryPending())) await refresh();
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
    const provider = getProvider();
    if (!provider) return status("Phantom not found — install it from phantom.app", "bad");
    const me = getAddress();
    if (!provider.publicKey) {
      // Session restored from a previous visit: Phantom itself isn't connected yet.
      try { await provider.connect(); } catch { return status("Connect Phantom to deposit.", "bad"); }
    }
    const live = activeAddress();
    if (live && me && live !== me) {
      return status(
        `Phantom is on account ${short(live)}, but you're signed in as ${short(me)}. ` +
        `Switch Phantom back to that account (or reconnect) before depositing — only transfers from the signed-in wallet are credited.`,
        "bad",
      );
    }
    busy = true;
    try {
      status("Approve the transfer in Phantom…");
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      const sig = await sendDeposit(provider, me, houseAddress, lamports, undefined, (signature) => {
        rememberDeposit(me, signature, lamports); // saved before we wait on the network
        renderPending();
        status(`Sent (${short(signature)}) — waiting for the network…`);
      });
      status("Confirmed on-chain — crediting…");
      await credit(sig);
      await refresh();
    } catch (err) {
      renderPending();
      const remembered = myPending().length > 0;
      status(
        (err.message || "Deposit failed") +
          (remembered ? " · Your transfer signature is saved; it will be credited automatically once it's visible on-chain." : ""),
        "bad",
      );
    } finally {
      busy = false;
    }
  });

  $("#wp-rec-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const sig = $("#wp-rec").value.trim();
    if (!SIGNATURE_RE.test(sig)) return status("That doesn't look like a Solana transaction signature.", "bad");
    busy = true;
    try {
      status("Checking that transaction on-chain…");
      if (await credit(sig)) {
        $("#wp-rec").value = "";
        await refresh();
      }
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
          : `Withdrawal is pending confirmation (${short(r.signature)}). Your balance will be restored automatically if it never lands.`,
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
  return { refresh, retryPending };
}
