# aicountly-qa

Internal **QA Testing Agent** portal for AICOUNTLY — [qa.aicountly.org](https://qa.aicountly.org).

## Purpose

- Functional and UI workflow testing of approved AICOUNTLY target apps
- Deterministic dummy data entry tagged with a unique `qa_run_id`
- Sequential Playwright session runs with screenshot, trace, console and network capture
- Accounting / report / UI validation against expected results
- Session-wise and consolidated QA reports (HTML + JSON)

This portal **does not**:
- modify target app source code or templates
- write directly to target app databases
- apply automated fixes
- behave like a developer agent

It is testing & reporting only. Code fixes belong in the target product repo.

## Stack

| Layer    | Technology                                                        |
|----------|-------------------------------------------------------------------|
| Frontend | React 19 + Vite + Tailwind (existing green AICOUNTLY palette)    |
| Backend  | PHP CodeIgniter 4.6 + PostgreSQL (independent JWT auth)          |
| Worker   | Node 20+ + Playwright in-repo (`worker/`, PM2 `aicountly-qa-worker`) |

## Repo layout

```
web/                      React QA portal (SPA)
server-php/               CodeIgniter 4.6 API
  app/Config/            Routes, Filters, Database, Services
  app/Controllers/Api/V1 REST controllers (Auth, Runs, Sessions, Worker…)
  app/Filters/           JwtFilter, RoleFilter, ProductionGuardFilter, WorkerAuthFilter
  app/Libraries/         Vault (AES-256-GCM), Jwt, RunIdGenerator
  app/Models/            One per qa_* table
  app/Services/          SessionPlannerService, ReportService, AuditService
  app/Database/
    Migrations/          18 + run-sequence migrations
    Seeds/               Roles, Owner, Books pack, Expected results, Rules, Settings
    Templates/books/     25+ session templates as JSON
worker/                   Dedicated Playwright worker (aicountly-qa-worker)
docs/                     Setup + architecture (+ QA-WORKER.md)
qa-reports/               Generated reports (gitignored)
.github/                  Deploy workflow (cPanel: web + api + worker)
```

## Quick start (local dev)

### 1. Database

```bash
createdb qa_aicountly
```

### 2. Backend API (CodeIgniter 4.6)

```bash
cd server-php
cp .env.example .env
# Set QA_DB_*, QA_JWT_SECRET (>=32 chars), QA_VAULT_KEY (64 hex chars), QA_WORKER_TOKEN
composer install
php spark migrate
php spark db:seed RolesSeeder
php spark db:seed OwnerSeeder            # prints initial owner password
php spark db:seed BooksTestDataPackSeeder
php spark db:seed BooksExpectedResultsSeeder
php spark db:seed ValidationRulesSeeder
php spark db:seed SettingsSeeder
php -S 0.0.0.0:8080 -t . index.php       # local API server
```

### 3. Frontend (React)

```bash
cd web
cp .env.example .env                     # set VITE_API_URL=http://localhost:8080
npm install
npm run dev
```

### 4. Playwright worker (dedicated, in this repo)

```bash
cd worker
cp .env.example .env                     # QA_API_URL + QA_WORKER_TOKEN (QA_* only)
npm install
npm run playwright:install
npm run build
npm start                                # banner: AICOUNTLY QA Worker (dedicated)
```

Production (QA cPanel): `~/aicountly-qa-worker`, PM2 name **`aicountly-qa-worker`**. See [docs/QA-WORKER.md](docs/QA-WORKER.md).

## Production deployment

- `.github/workflows/deploy-prod-cpanel.yml` (manual) ships:
  - `web/dist` → `public_html/`
  - `server-php/` → `public_html/api/`
  - `worker/` → `~/aicountly-qa-worker` + PM2 restart `aicountly-qa-worker`
- Worker auth is unchanged: `X-Worker-Token` / `QA_WORKER_TOKEN` against the QA API.

See [docs/QA-PORTAL-README.md](docs/QA-PORTAL-README.md) and [docs/QA-WORKER.md](docs/QA-WORKER.md) for setup, runtime contracts, and WHM one-time commands.
