# Hosting Vanta on a VPS

One Ubuntu/Debian VPS (1 vCPU, 1 GB RAM is plenty), a domain pointed at it, and
about 30 minutes. The backend runs as a systemd service on port 8787; nginx
serves the `web/` folder and proxies `/api/` to it, so the site and the API share
one origin over HTTPS.

Replace `casino.example.com` with your domain everywhere below.

## 1. Server basics

```bash
ssh root@YOUR_VPS_IP
apt update && apt install -y git nginx certbot python3-certbot-nginx
# Node 22+ (the code runs TypeScript natively; no build step)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
node --version   # must be 22.18 or newer

adduser --system --group --home /opt/vanta vanta
```

## 2. Get the code

```bash
sudo -u vanta git clone https://github.com/gwu0738/Website-recovery-.git /opt/vanta/app
cd /opt/vanta/app
sudo -u vanta npm install --omit=dev
```

## 3. House wallet (the hot wallet that holds the bankroll)

```bash
sudo -u vanta node scripts/make-house-wallet.mjs /opt/vanta/house.keypair.json
chmod 600 /opt/vanta/house.keypair.json
```

It prints the public address. **Use this wallet for nothing else, and keep only
what you are willing to lose in it.** Send it a small amount of SOL to start
(withdrawals are paid from it; `HOUSE_RESERVE_LAMPORTS` is never paid out, so it
always keeps fee money).

Back the keypair file up somewhere safe. If the disk dies, that file is the
bankroll.

## 4. Environment

```bash
cat > /opt/vanta/vanta.env <<'ENV'
PORT=8787
VANTA_DATA_DIR=/opt/vanta/data
SOLANA_CLUSTER=devnet
# SOLANA_CLUSTER=mainnet
# Mainnet: the public RPC rate-limits (403). Use a provider URL (Helius, QuickNode, Triton…).
# SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HOUSE_KEYPAIR_FILE=/opt/vanta/house.keypair.json
CORS_ORIGIN=https://casino.example.com
# Faucet anti-bot: proof-of-work bits (default 18 ≈ 1 s in a browser), or Turnstile instead
# FAUCET_POW_BITS=18
# TURNSTILE_SECRET=...
# Money limits (lamports; 1 SOL = 1000000000). Defaults are conservative; see server/config.ts.
# FAUCET_LAMPORTS=0            # 0 disables the free faucet (on mainnet it pays real SOL)
# MAX_STAKE_LAMPORTS=10000000  # 0.01 SOL
# MIN_WITHDRAW_LAMPORTS=1000000
# HOUSE_RESERVE_LAMPORTS=5000000
ENV
chown vanta:vanta /opt/vanta/vanta.env && chmod 600 /opt/vanta/vanta.env
mkdir -p /opt/vanta/data && chown vanta:vanta /opt/vanta/data
```

Start on **devnet** first (free test SOL from a faucet such as faucet.solana.com),
do a full deposit → bet → withdraw yourself, then switch to mainnet.

## 5. Run the backend as a service

```bash
cp /opt/vanta/app/deploy/vanta.service /etc/systemd/system/vanta.service
systemctl daemon-reload
systemctl enable --now vanta
systemctl status vanta          # should say active (running)
curl http://127.0.0.1:8787/api/health   # {"ok":true}
journalctl -u vanta -f          # live logs
```

## 6. Serve the site

No config edit is needed: with nginx proxying `/api/` on the same origin, the
page finds the backend by itself. (You can still pin it with `API_BASE` in
`web/js/config.js`.) For a stronger faucet captcha, create a free Cloudflare
Turnstile widget and set `TURNSTILE_SECRET` in `vanta.env` and
`TURNSTILE_SITE_KEY` in `web/js/config.js`; without it, the built-in
proof-of-work gate is used.

```bash
cp /opt/vanta/app/deploy/nginx.conf /etc/nginx/sites-available/vanta
sed -i 's/casino.example.com/YOUR_DOMAIN/g' /etc/nginx/sites-available/vanta
ln -sf /etc/nginx/sites-available/vanta /etc/nginx/sites-enabled/vanta
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d casino.example.com      # free HTTPS, auto-renews
```

Open https://casino.example.com. The badge in the top bar shows the cluster the
server is on; the panel under a game says "Real SOL on …" once signed in.

## 7. Backups (do this before real money)

The database is `/opt/vanta/data/accounts.db` (balances, seeds, sessions,
deposits, withdrawals). Nightly copy, kept off the box:

```bash
cat > /etc/cron.daily/vanta-backup <<'CRON'
#!/bin/sh
d=/opt/vanta/backups; mkdir -p $d
sqlite3 /opt/vanta/data/accounts.db ".backup $d/accounts-$(date +%F).db"
find $d -name 'accounts-*.db' -mtime +14 -delete
# then rsync/rclone $d somewhere off-server
CRON
chmod +x /etc/cron.daily/vanta-backup && apt install -y sqlite3
```

## 8. Updating

```bash
cd /opt/vanta/app && sudo -u vanta git pull && sudo -u vanta npm install --omit=dev
systemctl restart vanta
```

Restarts never sign players out or lose stakes: sessions and in-progress games
live in the database, and withdrawals interrupted mid-send are reconciled on
startup (check `journalctl -u vanta` for the reconciliation line).

## Checklist before mainnet

- [ ] Full cycle done on devnet from a real Phantom wallet (deposit, bet, withdraw)
- [ ] `SOLANA_RPC_URL` set to a paid/provider endpoint
- [ ] Faucet disabled or sized deliberately (`FAUCET_LAMPORTS`)
- [ ] Stake and withdrawal limits reviewed in `vanta.env`
- [ ] House wallet funded modestly; keypair backed up offline
- [ ] Backups verified by restoring one
- [ ] Legal: online gambling is restricted or illegal in many places; know your obligations
