# AICOUNTLY QA Portal

Internal QA Testing Agent for approved AICOUNTLY target applications.

## Scope

**In scope:** UI testing, dummy data, report/register verification, screenshots, traces, expected-vs-actual validation, QA report generation.

**Out of scope:** Source code changes, production DB writes, automatic fixes, developer agent behaviour.

## Naming

All modules, tables, env vars, and report paths use **QA** naming only (prefix `qa_`, env `QA_*`, run IDs `QA-RUN-YYYYMMDD-NNNN`).

## Environment modes

| Mode | Data creation | Notes |
|------|---------------|-------|
| Sandbox | Allowed | Full dummy data testing |
| GH / Staging | Allowed | Full testing on staging |
| Production Basic | Restricted | Login, navigation, dashboard, menus, report load, console/network only |
| Production Full | Disabled by default | Owner-only unlock; all writes blocked |

## Secrets (never commit)

- `QA_JWT_SECRET`, `QA_VAULT_KEY` — portal auth and credential encryption
- Target app credentials stored encrypted in DB, never in frontend or worker config files in git
- GitHub Actions: `PROD_SFTP_*`, `PROD_SSH_PRIVATE_KEY`, `VITE_API_URL`, `VITE_APP_NAME`

## Phased build

1. Clean scaffold (current)
2. PostgreSQL migrations + CodeIgniter 4.6 API
3. Portal auth, roles, target profiles, credential vault
4. Master prompt, session planner, Playwright worker
5. Books test data packs, validation engine, reports

## Worker

Playwright worker runs as a separate Node process. It claims queued sessions from the API, runs them **one at a time**, and uploads evidence to `qa-reports/{product}/{date}/{qa_run_id}/`.
