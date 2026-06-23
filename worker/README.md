# QA Worker (moved)

The Playwright worker no longer lives in this repo.

**Source & deploy:** [apis-aicountly/worker.apis.aicountly.com](https://github.com/aicountly/apis-aicountly/tree/main/worker.apis.aicountly.com)

**Production path (cPanel):**

```
/home/apisaicountly/public_html/worker.apis.aicountly.com
```

Subdomain: **worker.apis.aicountly.com**

The worker polls **qa.aicountly.org** (`QA_API_URL=https://qa.aicountly.org/api`) with `QA_WORKER_TOKEN` matching `server-php/.env` on the QA portal host.

See the [apis-aicountly worker README](https://github.com/aicountly/apis-aicountly/blob/main/worker.apis.aicountly.com/README.md) for install, PM2, and AlmaLinux setup.
