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
   └─ qa-reports/ ◄──── Worker (Playwright) ─┘
            (HTTPS X-Worker-Token)
```

Three independent processes:

- **web/** — React 19 SPA, served from GitHub Pages (preview) and cPanel `public_html/` (prod).
- **server-php/** — CodeIgniter 4.6 REST API at `/api`, served from cPanel `public_html/api/`.
- **worker/** — Long-running Node + Playwright process on a separate VPS / local host.

Sessions execute strictly one at a time. The worker uses `SELECT … FOR UPDATE SKIP LOCKED` so even multiple workers (not used in MVP) never race on the same row.

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
- GitHub Actions secrets: `PROD_SFTP_*`, `PROD_SSH_PRIVATE_KEY`, `VITE_API_URL`, `VITE_APP_NAME`.

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

### 4. Worker host (separate Node host)

```bash
cd worker
cp .env.example .env
# QA_API_URL=https://qa.aicountly.org/api  (or http://localhost:8080 for dev)
# QA_WORKER_TOKEN=<same value as server-php/.env>
# QA_REPORTS_DIR=../qa-reports
# QA_HEADLESS=1
npm install
npm run playwright:install
npm start
```

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
7. Worker logs into target app, runs steps, captures evidence, posts result.
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

No worker code changes are needed — the same `stepRunner.ts` consumes the JSON declaratively.

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

- `.github/workflows/deploy-github-pages.yml` — preview frontend
- `.github/workflows/deploy-prod-cpanel.yml` — frontend → `public_html/`, API → `public_html/api/`

The worker host is independent and out of scope for these workflows — operators deploy it manually (e.g. `pm2 start` on a VPS).
