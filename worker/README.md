# AICOUNTLY QA Worker (dedicated)

In-repo Playwright worker for the **QA portal only**.

| Identity | Value |
|----------|--------|
| npm package | `aicountly-qa-worker` |
| PM2 process name | `aicountly-qa-worker` |
| Startup banner | `AICOUNTLY QA Worker (dedicated)` |
| Env prefix | `QA_*` only (no `SMOKE_*`) |

This is **not** the shared host at `worker.apis.aicountly.com`. Agents can read and change this code in `aicountly-qa/worker/`.

## Production layout (QA cPanel)

```
/home/<QA_CPANEL_USER>/
  public_html/              # web + api (existing deploy)
  aicountly-qa-worker/      # this package (Node + Playwright)
  qa-reports/               # evidence root (QA_REPORTS_DIR)
```

The GitHub Actions workflow `deploy-prod-cpanel.yml` rsyncs this package to `~/aicountly-qa-worker` (sibling of `public_html`) and restarts PM2 `aicountly-qa-worker`.

## Local setup

```bash
cd worker
cp .env.example .env
# QA_API_URL=http://localhost:8080/api
# QA_WORKER_TOKEN=<same as server-php/.env>
# QA_WORKER_ID=aicountly-qa-worker-local
# QA_REPORTS_DIR=../qa-reports
npm install
npx playwright install chromium
npm run build
npm start
# or: npm run start:tsx
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Poll/claim loop (`dist/index.js`) |
| `npm run qa:run-session` | One session then exit |
| `npm run qa:basic-check` | Prod-safe login/nav only |
| `npm run qa:books` | Poll loop (soft books preference) |
| `npm run qa:reports -- --run-dir=...` | Rebuild consolidated HTML/JSON |
| `npm test` | Jump To + host-guard unit tests |

## API contract

Talks to `qa.aicountly.org/api` with header `X-Worker-Token: $QA_WORKER_TOKEN`:

- `GET /v1/worker/next-session` — claim + `runtime_contract`
- `POST /v1/worker/sessions/:id/heartbeat|progress|result|evidence`
- `GET /v1/worker/credentials/:id`
- Decisions: `POST/GET /v1/worker/decisions`, `…/timeout`, `GET /v1/worker/decision-memory`

## Runtime contracts implemented

- Product-scoped Jump To (`runtime_contract.login.jump_to_candidates`; candidate order wins)
- `expect_login_outcome` / `expect_product_host` → `AUTH_PRODUCT_HOST_MATCH`
- Mid-run `ask_decision` → `awaiting_decision` + heartbeat while paused
- Books File I/O kinds (sandbox import/export/compare; production `assert_file_upload_blocked`)
- `safeActionGuard` on production clicks

## One-time WHM / SSH setup

See [docs/QA-PORTAL-README.md](../docs/QA-PORTAL-README.md) § Worker (dedicated) for copy-paste AlmaLinux / cPanel commands (Node 20+, PM2, Playwright deps, `.env`, first `pm2 start`).

## Disconnect from shared worker

Do **not** point this process at `worker.apis.aicountly.com`. After the dedicated worker is healthy on the QA cPanel account, stop any QA-facing process that still runs on the shared apis host so only `aicountly-qa-worker` claims QA jobs.
