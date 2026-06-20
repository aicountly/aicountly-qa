# aicountly-qa

Internal **QA Testing Agent** portal for AICOUNTLY — [qa.aicountly.org](https://qa.aicountly.org).

## Purpose

- Functional and UI workflow testing of approved AICOUNTLY target apps
- Deterministic dummy data entry and validation
- Sequential Playwright session runs with evidence capture
- Session-wise and consolidated QA reports

This portal **does not** modify target app source code, production databases, or apply fixes automatically.

## Stack (planned)

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + Vite + Tailwind |
| Backend | PHP CodeIgniter 4.6 + PostgreSQL |
| Worker | Node 24 + Playwright |

## Repo layout

```
web/           React QA portal
server-php/    QA API (CodeIgniter scaffold pending)
worker/        Playwright worker (scaffold)
docs/          Setup and architecture notes
qa-reports/    Generated reports (gitignored)
.github/       Deploy workflows
```

## Local development

```bash
cd web
npm install
npm run dev
```

API health check (after deploy): `GET /api/health`

## Deployment

- **GitHub Pages** — auto on push to `main` (frontend)
- **cPanel** — manual workflow: `web/dist` → public_html, `server-php` → public_html/api

See [docs/QA-PORTAL-README.md](docs/QA-PORTAL-README.md) for full setup.
