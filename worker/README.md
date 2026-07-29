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

## Runtime contracts required by QA

The companion worker must implement these contracts before the new templates can run.

### Jump To login

`BKS_001_LOGIN_CTX` is a two-step login:

1. Fill identity.
2. Select Smart Books in `select#jumptoe` or `select[name=jumptoe]` (`Smart Books`, `{jump_to}`, or `books`).
3. Click **SIGN IN**, wait until the password input is visible, fill password, then click **CONTINUE/SIGN IN**.
4. Detect success by leaving `/login` for the Books shell. If the page stays on `/login`, collect visible Jump To, credential, password, OTP/2FA, verification, or challenge text in `failed_steps`.

The runner must support `selector_options`, `value_options`, `expect_login_outcome`, and the timeout/failure-note fields used by the template. OTP/challenge walls should use situation `login_otp_or_challenge`.

### Books File I/O

`BKS_029_FILE_IO` adds these declarative kinds: `ask_decision`, `file_import`, `expect_import_result`, `file_export`, `compare_file_roundtrip`, `file_upload_expect_rejected`, and `assert_file_upload_blocked`.

Resolve fixture paths relative to the template directory. Canonical CSV comparison ignores the declared generated columns. Never upload in `prod_basic` or `prod_full`; assert `blocked_by_safe_guard` without offering `approve_upload`.

### Mid-run decisions

Implement `askOrRecallDecision` as follows:

1. Query `GET /api/v1/worker/decision-memory?product_name=&environment=&situation_key=`.
2. Use a remembered option only when its id still exists in the current `options_json`. Audit that use with `POST /api/v1/worker/decisions` and `memory_applied=true`.
3. Otherwise create a pending decision with `POST /api/v1/worker/decisions`; keep the browser/session alive and continue posting session heartbeat while polling `GET /api/v1/worker/decisions/:id`.
4. Poll until `answered`, `timed_out`, or `cancelled`. After 30 minutes, call `POST /api/v1/worker/decisions/:id/timeout`.
5. Execute the selected action (`open_company`, `dismiss_overlay`, `wait_and_retry`, `approve_upload`, `skip_step`, `skip_file_io`, `mark_blocked`, `abort_session`, and situation-specific candidate ids), then resume or finish the template. Plain question/options are sufficient; no smoke phrasing layer is required.

Pending creation changes the session to `awaiting_decision`; answering restores `running` or `claimed`. A heartbeat is mandatory while paused so the lease remains visibly healthy.

## Shared-host regression checklist

After worker deployment, and again after adding any `SMOKE_*` variables or smoke process on the shared host:

- QA and smoke use separate API URLs/tokens, poll loops, process names, and report roots.
- A QA Jump To login reaches the password step and surfaces OTP/login errors.
- QA Live Log receives progress, heartbeat, and evidence.
- A pending QA decision pauses, appears in the portal, answers, resumes, and records its report audit row.
- Books File I/O uses only the deterministic fixture in sandbox and remains blocked in production.
- Restarting either portal worker process does not claim the other portal’s jobs.
