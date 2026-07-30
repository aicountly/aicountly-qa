# QA File I/O & data verification

File I/O is where the QA portal earns its keep. Smoke asks *"is this feature
missing?"*; QA asks *"did the number that went in come back out?"*

Every scenario answers four questions:

1. Did the transfer happen at all (upload accepted, export downloaded)?
2. Is the artifact the right **type** (MIME) and **shape** (headers, container)?
3. Does the artifact contain the right **number of rows**?
4. Do the **values** survive — key columns unchanged, numeric totals within tolerance?

Only question 1 and 2 exist on the smoke side. Questions 3 and 4 are QA-only.

## Where fixtures live

Canonical location: **`samples/fixtures/`** at the repo root.

```
samples/fixtures/
  manifest.json
  _common/bad-mime.png        # deliberately wrong type, for the reject path
  books/bank-statement.csv
  contacts/contacts-import.csv
  hrms/employees.csv
  fr/trial-balance.csv
  secretarial/member-register.csv
  calendar/schedule.ics
  docs/sample-doc.txt
  vault/secure-note.txt
```

Resolution order used by the worker (`worker/fileIo/manifest.ts`):

1. `$QA_FIXTURES_DIR`
2. `<repo>/samples/fixtures`
3. `<worker>/fixtures` (legacy per-product fixtures shipped with older workers)

Fixtures are small, synthetic, and deterministic. Never put real customer data here.

## Manifest format

`samples/fixtures/manifest.json`:

```json
{
  "version": 1,
  "defaults": { "numeric_tolerance": 0.01 },
  "products": {
    "books": [
      {
        "key": "bank-statement-round-trip",
        "kind": "round_trip",
        "fixture": "books/bank-statement.csv",
        "expected_mime": ["text/csv", "application/csv"],
        "menu_hints": ["banking", "bank statement", "import"],
        "expected_rows": 4,
        "key_columns": ["reference"],
        "numeric_columns": ["debit", "credit"],
        "numeric_tolerance": 0.01,
        "ignore_columns": ["id", "created_at", "updated_at", "balance"]
      }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `kind` | `upload`, `import`, `export`, `round_trip`, or `reject` |
| `menu_hints` | Scenario only runs if the session actually reached a matching screen |
| `expected_rows` | Row count the artifact must contain (QA-only) |
| `key_columns` | Column used to match a source row to a result row (QA-only) |
| `numeric_columns` | Columns whose totals are compared (QA-only) |
| `numeric_tolerance` | Absolute tolerance for numeric comparison |
| `ignore_columns` | Columns the target legitimately rewrites (ids, timestamps) |
| `reject_matches` | Regex the rejection message must match, for `kind: reject` |

## Execution order (worker)

`worker/fileIo/fileIoEngine.ts` runs, per scenario:

1. **Gate.** Observer-only tiers (`production_readonly`, `production_restricted`)
   and profiles with `allow_safe_demo = false` never upload. The scenario is
   recorded as `blocked` and the `FILE_IO_OBSERVER_UPLOAD_BLOCKED` rule *passes* —
   not uploading is the correct behaviour there.
2. **Operator approval.** A `upload_confirm:<product>:<scenario>` decision is
   raised (with a screenshot) before any synthetic file is written.
3. **Materialize.** The fixture is copied into the session directory so the
   original can never be modified.
4. **Upload / import**, then **download / export**.
5. **Compare** hash, MIME, and structure (`compareArtifacts.ts`).
6. **Verify data** (`dataVerification.ts`): rows, key column values, numeric totals.
7. **Persist** to `POST /api/v1/worker/sessions/{id}/file-io`, then upload each
   artifact to `POST /api/v1/worker/file-io/{testId}/artifact`.

### Status meanings

| `compare_status` | When |
| --- | --- |
| `pass` | Bytes match, or the file was re-serialised but structure and data hold |
| `partial` | Structure holds but data could not be fully verified |
| `fail` | Wrong MIME, broken structure, or a data mismatch |
| `blocked` | Observer-only tier: upload deliberately not attempted |
| `skipped` | Operator declined, or the fixture could not be staged |
| `not_applicable` | Upload-only scenario with no export leg to compare |

## Storage

Table `qa_file_io_tests`, one row per `(session_id, scenario_key)`. A session
re-run overwrites its previous verdict rather than stacking duplicates.

Artifacts are copied to the API host under
`{QA_REPORTS_DIR}/{product}/{date}/{qa_run_id}/session-NNN/file-io/{scenario}/`
and served through the run's artifact endpoint. The endpoint refuses any path
that resolves outside the reports root.

The worker and the API do not have to share a filesystem. The paths in the
result POST are worker-local, so the API keeps only the ones it can actually
read and files the rest under `evidence_json.worker_artifact_paths` for
debugging. The multipart upload is what makes an artifact downloadable, which
means `artifact_keys` only ever lists artifacts this host can serve.

## Validation rules

Failures roll up into the Error Register through the normal validation path.
The generic (product-agnostic) rules are defined in
`server-php/app/Services/FileIoRuleCatalog.php` and seeded by migration:

- `FILE_IO_TRANSFER_OK`
- `FILE_IO_MIME_EXPECTED`
- `FILE_IO_STRUCTURE_MATCH`
- `FILE_IO_ROW_COUNT_MATCH`
- `FILE_IO_KEY_VALUES_MATCH`
- `FILE_IO_NUMERIC_TOTALS_MATCH`
- `FILE_IO_OBSERVER_UPLOAD_BLOCKED`
- `FILE_BAD_MIME_REJECTED`

## API

```
GET  /api/v1/runs/{qaRunId}/file-io
GET  /api/v1/runs/{qaRunId}/file-io/{testId}/artifact/{key}
POST /api/v1/worker/sessions/{sessionId}/file-io          (worker token)
POST /api/v1/worker/file-io/{testId}/artifact             (worker token, multipart)
```

Artifact `key` is whatever the worker recorded in `artifact_paths` — currently
`fixture` (the staged synthetic input) and `downloaded` (what the app produced).
`GET .../file-io` returns `artifact_keys` so the UI can build the links.

### Data-verification fields on `GET .../file-io`

| Field | Type | Meaning |
| --- | --- | --- |
| `rows_expected` / `rows_found` | int \| null | Data-row counts, `null` when the format could not be read structurally |
| `mismatched_cells` | int \| null | How many cells differ. This is the number the run detail table shows |
| `mismatches` | array | Up to 25 offending cells (`key`, `column`, `expected`, `actual`), used for the hover detail. Never a count |
| `data_verified` | bool \| null | Overall verdict. `null` means the format was not machine-comparable, so it is neither a pass nor a fail |

`summary.mismatched_cells` is the run-wide sum, and `summary.data_verified` /
`summary.data_verifiable` count rows rather than cells.
