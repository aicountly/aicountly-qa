# AICOUNTLY QA Portal

Internal QA Testing Agent for approved AICOUNTLY target applications.

## Scope

**In scope:** UI testing, dummy data, report/register verification, screenshots, traces, expected-vs-actual validation, QA report generation.

**Out of scope:** Source code changes, production DB writes, automatic fixes, developer agent behaviour.

## Architecture

```
React SPA  ───jwt──►  CI4.6 API  ───►  PostgreSQL
   ▲                     ▲                  ▲
   │                     │                  │
   └─ qa-reports/ ◄──── dedicated QA Worker (Playwright) ─┘
            (HTTPS X-Worker-Token)
```

Three independent processes (all owned by this repo / QA cPanel account):

- **web/** — React 19 SPA, served from cPanel `public_html/`.
- **server-php/** — CodeIgniter 4.6 REST API at `/api`, served from cPanel `public_html/api/`.
- **worker/** (`aicountly-qa-worker`) — dedicated Playwright worker on the QA cPanel host at `~/aicountly-qa-worker` (sibling of `public_html`). PM2 name **`aicountly-qa-worker`**. Not the shared `worker.apis.aicountly.com` process.

Sessions execute strictly one at a time. The worker uses `SELECT … FOR UPDATE SKIP LOCKED` so even multiple workers (not used in MVP) never race on the same row.

See [QA-WORKER.md](./QA-WORKER.md) for deploy path, PM2, and one-time AlmaLinux setup.

## Naming rules (strict)

- Tables: `qa_*` only
- Env vars: `QA_*` only
- Run IDs: `QA-RUN-YYYYMMDD-NNNN` (daily-rolling, generated atomically in the API)
- Folders for reports: `qa-reports/{product}/{YYYY-MM-DD}/{qa_run_id}/`
- Worker scripts use the same `qa:*` prefix

The repo never references any internal observation tool by name.

## Environment modes

| Mode             | Data creation             | Behaviour                                                                                  |
|------------------|---------------------------|--------------------------------------------------------------------------------------------|
| `sandbox`        | Allowed                   | Full dummy data, full reporting                                                            |
| `gh`             | Allowed                   | Same as sandbox; for staging stacks                                                        |
| `prod_basic`     | Refused on writes         | Login + nav + report-page-load only; ProductionGuardFilter blocks data_creation POSTs       |
| `prod_full`      | Locked by default         | All writes blocked at API filter, worker safeActionGuard, and UI banner unless Owner unlock |

## Roles (independent JWT auth)

| Role               | Manage users / settings | Target profiles | Approve sessions | Run tests | View only |
|--------------------|-------------------------|-----------------|------------------|-----------|-----------|
| Owner              | ✓                       | ✓               | ✓                | ✓         | ✓         |
| QA Manager         |                         | ✓               | ✓                | ✓         | ✓         |
| Developer Viewer   |                         |                 |                  |           | reports + error register |
| Auditor Viewer     |                         |                 |                  |           | final reports + audit logs |

Roles are enforced by `app/Filters/JwtFilter.php` + `app/Filters/RoleFilter.php`.

## Secrets

Stored in env files only (never committed):

- `QA_JWT_SECRET` — HS256 signing key (≥32 chars). Generate: `php -r "echo bin2hex(random_bytes(32));"`
- `QA_VAULT_KEY`  — AES-256-GCM credential key (64 hex chars). Generate: `php -r "echo bin2hex(random_bytes(32));"`
- `QA_WORKER_TOKEN` — long-lived shared secret used by the worker. Generate: `php -r "echo bin2hex(random_bytes(48));"`
- Target app passwords are AES-256-GCM encrypted via `App\Libraries\Vault` before being persisted. The worker fetches them only at session start through `/api/v1/worker/credentials/{id}`.
- GitHub Actions secrets: `PROD_SSH_HOST`, `PROD_SSH_PORT`, `PROD_SSH_USER`, `PROD_REMOTE_ROOT`, `PROD_SSH_PRIVATE_KEY`, `VITE_API_URL`, `VITE_APP_NAME`, plus `QA_*` API secrets.

## Setup walkthrough

### 1. PostgreSQL

```bash
createdb qa_aicountly
```

### 2. API

```bash
cd server-php
cp .env.example .env
# Edit .env:
#   QA_DB_HOST, QA_DB_PORT, QA_DB_NAME, QA_DB_USER, QA_DB_PASSWORD
#   QA_JWT_SECRET, QA_VAULT_KEY, QA_WORKER_TOKEN
#   QA_ALLOWED_ORIGINS=http://localhost:5173,https://qa.aicountly.org
composer install
php spark migrate
php spark db:seed RolesSeeder
php spark db:seed OwnerSeeder              # prints initial password — change on first login
php spark db:seed BooksTestDataPackSeeder
php spark db:seed BooksExpectedResultsSeeder
php spark db:seed ValidationRulesSeeder
php spark db:seed SettingsSeeder
php -S 0.0.0.0:8080 -t . index.php
# Health:  http://localhost:8080/health
```

### 3. Web

```bash
cd web
cp .env.example .env
# VITE_API_URL=http://localhost:8080
# VITE_APP_NAME=AICOUNTLY QA Portal
npm install
npm run dev
# Open http://localhost:5173 — sign in with the seeded owner.
```

### 4. Dedicated QA worker (in this repo)

```bash
cd worker
cp .env.example .env
# QA_API_URL=http://localhost:8080/api   # or https://qa.aicountly.org/api
# QA_WORKER_TOKEN=<same value as server-php/.env>
# QA_WORKER_ID=aicountly-qa-worker
# QA_REPORTS_DIR=../qa-reports
npm install
npx playwright install chromium
npm run build
npm start
```

Production path on the **QA** cPanel account: `~/aicountly-qa-worker` with PM2 name **`aicountly-qa-worker`**. Deployed by the same cPanel GitHub Actions workflow as web + API. Full one-time WHM commands: [QA-WORKER.md](./QA-WORKER.md).

The worker polls every `QA_POLL_INTERVAL_MS` ms, claims the next `queued` session, executes it end-to-end, then loops.

## Worker scripts

| Script              | Purpose                                                                                                                 |
|---------------------|--------------------------------------------------------------------------------------------------------------------------|
| `npm start`         | Default poll-and-claim loop                                                                                              |
| `npm run qa:basic-check` | One-shot prod-safe run: login + nav + report-page loads only                                                       |
| `npm run qa:run-session` | One-shot: claim the next queued session, run it, then exit                                                          |
| `npm run qa:books`  | Loop, but only claim books-product sessions                                                                              |
| `npm run qa:reports -- --run-dir=qa-reports/books/2026-06-19/QA-RUN-20260619-0001` | Rebuild consolidated HTML/JSON from existing session reports |
| `npm run qa:validate`    | Re-run validation engines over existing session JSON (stub in v1)                                                   |
| `npm run qa:cleanup`     | Cleanup data tagged with a qa_run_id via the target UI; refuses to run on `prod_basic` / `prod_full`               |

## QA run lifecycle

```
1. Owner / QA Manager creates Target App Profile + credentials.
2. New QA Run page →  pick profile, write master prompt.
3. SessionPlannerService generates a draft session plan from product templates.
4. Reviewer (Owner / QA Manager) edits / reorders / removes sessions, then Approves.
5. Each approved session is enqueued in qa_sessions with status=queued.
6. Worker polls /worker/next-session → claims oldest queued session.
7. Worker logs in through identity → the claimed profile’s product-scoped Jump To → password, verifies the resulting host against profile `base_url` / `allowed_domains`, runs steps, captures evidence, and posts the result. OTP/2FA or ambiguous/unsafe paths can pause as `awaiting_decision`.
8. API writes session report (HTML + JSON) under qa-reports/{product}/{date}/{qa_run_id}/.
9. When no queued sessions remain, API builds the consolidated final report.
10. Reports are surfaced in /qa-reports and /qa-runs/:id in the UI.
```

## Reports — folder layout

```
qa-reports/
  books/
    2026-06-19/
      QA-RUN-20260619-0001/
        session-001-login-and-company-context/
          screenshots/   001-after-login.png …
          trace.zip
          report.html
          report.json
        session-002-ledger-masters/
          …
        consolidated.html
        consolidated.json
```

Both worker and API write under the same root (`QA_REPORTS_DIR`). The folder is gitignored.

## Adding a new product / session template

1. Create `server-php/app/Database/Templates/<product>/_index.json` listing the templates (`code`, `name`, `module`, `order`, `splits`).
2. Add one JSON per template `code` next to `_index.json`. Each JSON must include `steps[]` and `validations[]`. See `BKS_003_LEDGER.json` for a fully-wired example.
3. (Optional) Add a test data pack and expected results seeder under `server-php/app/Database/Seeds/`.
4. (Optional) Add product-specific validation rules via `ValidationRulesSeeder`.

The in-repo worker (`worker/`) consumes templates declaratively. Upgrade `worker/runner/stepRunner.ts` (and related modules) when adding new step kinds. Supported additions include `expect_login_outcome`, `expect_product_host` (`AUTH_PRODUCT_HOST_MATCH`), `ask_decision`, and Books File I/O kinds (`file_import`, `expect_import_result`, `file_export`, `compare_file_roundtrip`, `file_upload_expect_rejected`, `assert_file_upload_blocked`).

Claimed jobs include an additive `runtime_contract`: ordered Jump To candidates derived from `product_name`, plus the expected base URL, allowed domains, one-recovery policy, and `AUTH_PRODUCT_HOST_MATCH` validation code. Candidate order must win over dropdown order. A mismatch that remains after one direct navigation is a critical QA error; the worker attaches the landed URL, selected Jump To, expected/actual hosts, and screenshot instead of scanning the wrong product.

## Mid-run operator decisions

The worker first asks decision memory for the product/environment/situation. Valid remembered options are audited without pausing. Otherwise it creates a pending decision, the API sets the session to `awaiting_decision`, and the portal polls the run’s pending decisions. Owner or QA Manager answers with an option id, optional note, and optional remember flag; the API resumes the session to `running`/`claimed`.

While paused, the worker must heartbeat its lease, poll the decision, and time it out after 30 minutes. It then executes the selected action and resumes or finishes. `abort_session` and `mark_blocked` always produce an Error Register entry. Reports include situation, selected choice, and whether a human or memory supplied it.

The QA decision routes are:

- Worker token: `POST /v1/worker/decisions`, `GET /v1/worker/decisions/{id}`, `POST /v1/worker/decisions/{id}/timeout`, `GET /v1/worker/decision-memory`.
- Owner/QA Manager JWT: `GET /v1/runs/{qaRunId}/decisions`, `POST /v1/runs/{qaRunId}/decisions/{id}/answer`, `GET /v1/runs/{qaRunId}/decisions/{id}/screenshot`.

## Portal isolation checklist

QA and smoke must remain isolated by API URL/token, process name (`aicountly-qa-worker` vs smoke’s PM2 name), poll loop, report root, and product-specific Jump To. Checklist after deploy: QA Jump To login, deliberate wrong-product host failure with evidence, Live Log heartbeat/progress, evidence upload, decision pause/answer/resume, Books sandbox File I/O, production upload refusal. Restart each portal’s worker independently and confirm neither claims the other portal’s jobs.

## Books — fully wired end-to-end session (proof point)

The **Ledger Masters** (`BKS_003_LEDGER`) session is wired all the way through:

- Selector map with `selector_options[]` fallbacks
- 3 deterministic ledgers (`{QA_RUN_ID} Customer A`, `Supplier A`, `HDFC Bank`)
- After creation, the ledger list is re-read and asserted for visibility
- Validation rules: `UI_REQUIRED_FIELDS`, `UI_SAVE_WORKS`, `UI_NO_BLANK_PAGE`, `UI_NO_CRITICAL_CONSOLE`, `UI_NO_UNHANDLED_API`, `CTX_PERSISTENCE`
- Screenshot + trace + console + network capture written under the session directory
- Session report HTML/JSON, then consolidated report

Other Books templates ship as JSON only; running them requires no additional code changes.

## What ships disabled or stubbed (intentional)

| Feature                                  | Status           | How to enable                                                  |
|------------------------------------------|------------------|----------------------------------------------------------------|
| LLM session planner                      | Off              | Settings → `llm_enabled=true`, set `QA_LLM_PROVIDER/API_KEY` |
| flow.aicountly.org ticket webhook        | Off              | Settings → `flow_webhook_enabled=true`, set webhook URL       |
| Production write unlock                  | Off              | Settings → `production_unlock.enabled=true` (Owner only)      |
| Cleanup on production targets            | Always refused   | Run cleanup only against sandbox / gh                          |

## Security guardrails

- **API layer**: `ProductionGuardFilter` blocks data_creation writes on `prod_basic` / `prod_full` unless Owner unlock is active. `RoleFilter` enforces Owner / QA Manager / Viewer access. `JwtFilter` validates every authenticated route.
- **Worker layer**: `safeActionGuard` refuses to click any button whose text matches `Delete | Remove | Reset | Finalize | File Return | Generate E-Invoice | Generate E-Way Bill | Submit to GST | Sync Live | Approve | Reject | Post Permanently` on production targets. Throws `SafeActionBlocked`; the session is marked `blocked_by_safe_guard`.
- **Frontend layer**: `ProductionBanner` is shown across the SPA when the active target is production. Forms disable destructive actions client-side.
- **Audit log**: every login, profile change, credential rotation, plan generation, session approval, session execution, credential fetch, screenshot capture, settings change is appended to `qa_audit_logs`. Append-only — never updated.

## CI / CD

- `.github/workflows/deploy-prod-cpanel.yml` (manual) deploys:
  - `web/dist` → `public_html/`
  - `server-php/` → `public_html/api/`
  - `worker/` → `~/aicountly-qa-worker` and restarts PM2 **`aicountly-qa-worker`**

Worker `.env` is never written by GitHub Actions (create once on the server). Details: [QA-WORKER.md](./QA-WORKER.md).
