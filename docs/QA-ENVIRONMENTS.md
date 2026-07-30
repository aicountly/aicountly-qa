# Environment tiers

QA uses the same five tiers as the smoke portal, defined once in
`server-php/app/Config/Environments.php` and mirrored for the worker in
`worker/utils/environments.ts`.

| Value | Label | Production? | Observer only? | Data creation | File actions |
| --- | --- | --- | --- | --- | --- |
| `sandbox` | Sandbox | no | no | yes | yes |
| `gh_staging` | GH Staging | no | no | yes | yes |
| `production_readonly` | Production (read only) | yes | **yes** | no | no |
| `production_restricted` | Production (restricted) | yes | **yes** | no | no |
| `production_full_access` | Production (full access) | yes | no | yes | yes |

## The one rule that matters

**Never** test a tier with `str_starts_with($env, 'production')`. That sweeps
`production_full_access` — a live target the owner deliberately opted into full
permissions on — into the observer-only rules. Use the capability helpers:

```php
Environments::isProduction($env);        // banner / red badge
Environments::isObserverOnly($env);      // no writes, no file actions, ever
Environments::allowsDataCreation($env);
Environments::allowsFileActions($env);
```

```ts
import { isObserverOnly, allowsFileActions } from './utils/environments.js'
```

## Legacy values

Older rows and older worker builds may still send the pre-rename values. They
are translated on the way in, everywhere:

| Legacy | Canonical |
| --- | --- |
| `gh` | `gh_staging` |
| `prod_basic` | `production_readonly` |
| `prod_full` | `production_full_access` |

Migration `2026-07-30-000025_MigrateEnvironmentTiers` rewrites the stored values
in `qa_target_profiles`, `qa_runs`, and `qa_decision_memory`. It drops any old
`CHECK` constraint on those columns first, and de-duplicates
`qa_decision_memory` rows that would collide once `gh` and `gh_staging` become
the same value.

`Environments::templateKeys()` (and its TypeScript twin) is what reads a
template's `steps_by_env` block: it tries the canonical key, then the legacy
aliases, and finally falls back to the read-only script for observer tiers. So
`production_restricted` inherits the `production_readonly` steps unless a
template declares its own.

## Profile overrides

Saving a target profile on an observer-only tier force-sets, regardless of what
the request body said:

- `observer_mode = true`
- `read_only = true`
- `production_restriction = true`
- `allow_safe_demo = false`
- `data_creation_allowed = false`

Moving a profile off an observer tier restores the submitted values.

## API

`GET /api/v1/environments` returns the catalogue for the UI:

```json
{
  "ok": true,
  "data": {
    "default": "sandbox",
    "environments": [
      {
        "value": "production_readonly",
        "label": "Production (read only)",
        "description": "…",
        "is_production": true,
        "observer_only": true,
        "allows_data_creation": false,
        "allows_file_actions": false
      }
    ],
    "legacy_map": { "gh": "gh_staging", "prod_basic": "production_readonly", "prod_full": "production_full_access" }
  }
}
```
