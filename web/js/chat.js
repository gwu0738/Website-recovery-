// =============================================================================
// Live chat UI — front-end only, exactly as you asked.
//
// It "auto-manages space and history" like the chat on sites of this kind:
//   - keeps a rolling buffer (old messages drop off, memory stays bounded)
//   - auto-scrolls to the newest message unless you've scrolled up to read
//   - persists recent history in localStorage so it survives a refresh
//   - simulates ambient activity so the room never looks dead in a demo
//
// There is NO backend here. To make it real later, replace `startAmbient()`
// and `send()` with a WebSocket to your server; the rendering stays the same.
// =============================================================================

const MAX_MESSAGES = 150; // rolling buffer cap — this is the "auto space" part
const STORAGE_KEY = "vanta_chat_history";

const FAKE_USERS = [
  "degen_sol", "moonboy", "0xViper", "luckyLuna", "crashKing",
  "minesweeper", "wheelWatch", "satoshifan", "greenCandle", "apeInApe",
];
const FAKE_LINES = [
  "gm", "lfg 🚀", "just hit 12x on limbo", "dice is cold today",
  "wen payout", "verified my last bet, clean ✅", "mines got me again 😤",
  "who's up?", "provably fair ftw", "big crash coming i can feel it",
];

export class Chat {
  constructor(listEl, inputEl, formEl) {
    this.listEl = listEl;
    this.inputEl = inputEl;
    this.formEl = formEl;
    this.messages = this.load();
    this.pinnedToBottom = true;
    this.timer = null;

    this.listEl.addEventListener("scroll", () => {
      const nearBottom =
        this.listEl.scrollHeight - this.listEl.scrollTop - this.listEl.clientHeight < 40;
      this.pinnedToBottom = nearBottom;
    });

    this.formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.inputEl.value.trim();
      if (!text) return;
      this.push({ user: "you", text, self: true });
      this.inputEl.value = "";
    });

    this.render();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.messages.slice(-MAX_MESSAGES)));
    } catch {
      /* storage can be unavailable (private mode) — ignore */
    }
  }

  push(msg) {
    this.messages.push({ ...msg, ts: Date.now() });
    // Auto-manage space: keep only the last MAX_MESSAGES in memory + DOM.
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    this.save();
    this.render();
  }

  render() {
    this.listEl.innerHTML = "";
    for (const m of this.messages) {
      const row = document.createElement("div");
      row.className = "chat-msg" + (m.self ? " self" : "");
      const time = new Date(m.ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      row.innerHTML =
        `<span class="chat-user">${escapeHtml(m.user)}</span>` +
        `<span class="chat-text">${escapeHtml(m.text)}</span>` +
        `<span class="chat-time">${time}</span>`;
      this.listEl.appendChild(row);
    }
    if (this.pinnedToBottom) {
      this.listEl.scrollTop = this.listEl.scrollHeight;
    }
  }

  // Simulated room activity so the demo feels alive. Remove for production.
  startAmbient() {
    const tick = () => {
      const user = FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)];
      const text = FAKE_LINES[Math.floor(Math.random() * FAKE_LINES.length)];
      this.push({ user, text });
      this.timer = setTimeout(tick, 3000 + Math.random() * 5000);
    };
    this.timer = setTimeout(tick, 1500);
  }

  stopAmbient() {
    if (this.timer) clearTimeout(this.timer);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
