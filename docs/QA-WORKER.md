# Dedicated QA Playwright Worker

The QA worker lives in this repo at [`worker/`](../worker/) as package **`aicountly-qa-worker`**.

It is **not** deployed to `worker.apis.aicountly.com` and must not share a process, env prefix, or report root with the smoke portal.

## Identity

| Surface | Value |
|---------|--------|
| package.json `name` | `aicountly-qa-worker` |
| PM2 name | `aicountly-qa-worker` |
| `process.title` | `aicountly-qa-worker` |
| Startup banner | `AICOUNTLY QA Worker (dedicated)` |
| Default `QA_WORKER_ID` | `aicountly-qa-worker` |

## Deploy path (QA cPanel)

Relative to `PROD_REMOTE_ROOT` (e.g. `/home/qaaicountly/public_html`):

```
/home/<QA_CPANEL_USER>/
  public_html/                 # SPA + api/
  aicountly-qa-worker/         # Node package (sibling of public_html)
  qa-reports/                  # QA_REPORTS_DIR
```

Optional GitHub secret `PROD_WORKER_ROOT` overrides the worker directory. Default is `$HOME/aicountly-qa-worker`.

Deploy is part of [`.github/workflows/deploy-prod-cpanel.yml`](../.github/workflows/deploy-prod-cpanel.yml): build TypeScript → rsync → `npm ci --omit=dev` → `playwright install chromium` → `pm2 restart aicountly-qa-worker`.

## One-time WHM / terminal setup (copy-paste)

Run once on the QA cPanel account (AlmaLinux). Replace `qaaicountly` with the real cPanel user if different.

```bash
# 1) Node 20+ (if `node -v` is missing or < 20)
# Prefer cPanel "Setup Node.js App" / nvm, or system Node from NodeSource.
node -v
npm -v

# 2) PM2 (user-level)
npm install -g pm2
pm2 startup
# run the command that `pm2 startup` prints (may need root once)

# 3) Directories
mkdir -p ~/aicountly-qa-worker ~/qa-reports
chmod 755 ~/aicountly-qa-worker
chmod 775 ~/qa-reports

# 4) Playwright OS deps (ONCE as root / WHM terminal — AlmaLinux)
# After the first GitHub deploy has placed package.json on the server:
cd ~/aicountly-qa-worker
# As root (WHM Terminal or sudo):
#   cd /home/qaaicountly/aicountly-qa-worker && npx playwright install-deps chromium

# 5) Worker env (once — never overwritten by deploy)
cp ~/aicountly-qa-worker/.env.example ~/aicountly-qa-worker/.env
chmod 600 ~/aicountly-qa-worker/.env
# Edit .env:
#   QA_API_URL=https://qa.aicountly.org/api
#   QA_WORKER_TOKEN=<exact same value as ~/public_html/api/.env QA_WORKER_TOKEN>
#   QA_WORKER_ID=aicountly-qa-worker
#   QA_REPORTS_DIR=/home/qaaicountly/qa-reports
#   QA_HEADLESS=1

# 6) First start (after a successful Actions deploy, or local npm run build)
cd ~/aicountly-qa-worker
npm ci --omit=dev || npm install --omit=dev
npx playwright install chromium
pm2 start ecosystem.config.cjs
pm2 save
pm2 list   # expect name: aicountly-qa-worker
pm2 logs aicountly-qa-worker --lines 50
```

Firewall: the worker only makes **outbound** HTTPS to `qa.aicountly.org` and the target product hosts. No inbound ports are required for the worker process.

## Disconnect shared worker

1. Confirm `pm2 list` on the **QA** cPanel user shows `aicountly-qa-worker` online and heartbeats appear on the QA dashboard.
2. On the shared `apisaicountly` host, stop any process that still polls `QA_API_URL=https://qa.aicountly.org/api` (do not modify the apis-aicountly repo from this change — just stop the old QA consumer if it is still running there).
3. Verify only `aicountly-qa-worker` claims new QA sessions.

## Secrets / env

| Where | Keys |
|-------|------|
| `public_html/api/.env` | `QA_WORKER_TOKEN` (authoritative) |
| `~/aicountly-qa-worker/.env` | `QA_API_URL`, `QA_WORKER_TOKEN` (must match), `QA_WORKER_ID`, `QA_REPORTS_DIR`, `QA_HEADLESS` |
| GitHub Actions | Existing `PROD_SSH_*`, `PROD_REMOTE_ROOT`, optional `PROD_WORKER_ROOT` — **no** worker token in GitHub |

## Runtime contracts

Documented for agents and operators; implemented under `worker/`:

- Jump To from `runtime_contract.login.jump_to_candidates` (candidate order wins)
- `expect_login_outcome`, `expect_product_host` / `AUTH_PRODUCT_HOST_MATCH`
- `ask_decision` + decision memory / timeout (30 minutes) with heartbeats while `awaiting_decision`
- Books File I/O step kinds; production asserts `blocked_by_safe_guard` without uploading
