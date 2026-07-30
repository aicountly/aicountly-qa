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

## AI Brain env vars

The worker never holds a provider API key — `GEMINI_API_KEY` / `OPENAI_API_KEY`
/ `PERPLEXITY_API_KEY` live only in `server-php/.env`, and `validateConfig()`
(`worker/utils/config.ts`) hard-fails startup if any of the three leaks into
the worker's own environment. The worker only controls *how* it runs, via:

| Var | Default | Meaning |
|-----|---------|---------|
| `QA_AGENT_MODE` | `template` | `template` = today's deterministic step-by-step execution (unchanged). `agent` = the vision agent loop drives the browser instead. |
| `QA_MAX_SCREENS_PER_SESSION` | `60` | Safety ceiling on screens the vision agent may visit in one session (agent mode only). |
| `QA_STEP_SCREENSHOT_RETENTION` | `120` | How many of the agent's per-step decision screenshots to keep on disk (agent mode only). |
| `QA_FEATURE_GAP_ENABLED` | `false` | Enables the extra council call that compares the product against competitor catalogs and posts findings to `qa_feature_gaps`. Enrichment only, never affects pass/fail. |

`template` mode is what every session has always run: `stepRunner.ts` executes
the session template's declared steps in order. `agent` mode instead hands the
browser to `agentLoop.ts`, which perceives the screen via Set-of-Marks and
decides one action at a time, gated by a mandatory data-capture contract so
that AI-driven exploration can't finish a session without ever having read
the numbers under test. See [docs/QA-BRAIN.md](./QA-BRAIN.md) for the full
architecture, provider routing, and rollback instructions.

## Runtime contracts

Documented for agents and operators; implemented under `worker/`:

- Jump To from `runtime_contract.login.jump_to_candidates` (candidate order wins)
- `expect_login_outcome`, `expect_product_host` / `AUTH_PRODUCT_HOST_MATCH`
- `ask_decision` + decision memory / timeout (30 minutes) with heartbeats while `awaiting_decision`
- Manifest-driven File I/O with data verification; observer-only tiers assert `blocked_by_safe_guard` without uploading

## Environment tiers in the worker

`worker/utils/environments.ts` mirrors `server-php/app/Config/Environments.php`.
Use `isObserverOnly()` / `allowsFileActions()` — never a `startsWith('production')`
check, which would wrongly restrict `production_full_access`. Legacy values
(`gh`, `prod_basic`, `prod_full`) arriving from an older API are normalized on
the way in, and `templateKeys()` still reads legacy `steps_by_env` keys.

`safeActionGuard` now takes `allowSafeDemo` from the target profile:
observer-only tiers and profiles with `allow_safe_demo = false` never upload.

## File I/O engine

`worker/fileIo/` contains:

| Module | Role |
| --- | --- |
| `manifest.ts` | Loads `samples/fixtures/manifest.json`, filters scenarios by product and by the screens the session reached, materializes fixtures into the session directory |
| `transferHelpers.ts` | Selector-tolerant upload / download / expect-rejection primitives |
| `compareArtifacts.ts` | SHA-256, MIME sniffing, and structure checks for CSV / ICS / PDF / XLSX |
| `dataVerification.ts` | QA-only: row counts, key-column cell values, numeric totals within tolerance |
| `fileIoEngine.ts` | Orchestrates gate → approval → transfer → compare → verify → persist |
| `fileIoSteps.ts` | Legacy declarative step kinds for templates that script the flow explicitly |

Results post to `POST /v1/worker/sessions/{id}/file-io`, then each artifact is
copied to the API host via `POST /v1/worker/file-io/{testId}/artifact` so the
portal can serve it even when the worker runs elsewhere. Full details:
[QA-FILE-IO.md](./QA-FILE-IO.md).

## Decision screenshots

When the worker raises a decision it screenshots the blocked screen, uploads it
through the evidence endpoint, and passes the stored path as `screenshot_path`,
so the operator card shows an image instead of a bare question. A failure to
capture never blocks the decision from being raised.
