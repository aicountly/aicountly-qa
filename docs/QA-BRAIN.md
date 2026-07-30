# QA AI Brain

How the QA portal's optional vision-agent execution mode is wired to the same
three-provider AI brain (Gemini, OpenAI, Perplexity) used by the sibling
smoke portal, and why QA's agent is structurally different from smoke's.

## Overview

The smoke portal's AI layer verifies report **output**: does a generated
report match the expected format/standards, and how does it compare with
competitor products. QA verifies **data quality**: was this specific number,
row, or total actually processed correctly by the target app. That
difference in job drives the one structural difference in the agent design:
QA's vision agent is not a free explorer. It is bounded by a mandatory
**capture contract** (see below) that forces it to visit and record the
report/screen values a session's template declared as important before it
is allowed to declare the session done. Without that constraint, a vision
agent could "explore" a whole session, decide everything looked fine, and
never actually read the figures the session exists to check — a false-green
result. Everything else (provider ensemble, key isolation, Set-of-Marks
perception, safety guards) is a direct port from smoke.

## Provider routing

Read from `server-php/app/Services/Brain/BrainEnsemble.php` and the settings
seeded by `server-php/app/Database/Seeds/SettingsSeeder.php`.

| Task | Providers (setting, default) | Mode |
|------|-------------------------------|------|
| Vision (screenshot review, e.g. `vision_agent`) | `brain.vision_providers` (`gemini`, `openai`) | Sequential fallback via `invokeVision()` — one JSON-repair retry per provider, then a `BrainUnavailableException`. |
| `plan` | `brain.plan_providers` (`openai`, `gemini`), gated by `brain.plan_mode` (`fast`) | Single fastest configured planner wins; set `brain.plan_mode=council` to force the full council path below. |
| `synthetic_data` | `brain.data_providers` (`perplexity`, `openai`) | Sequential — first provider to return a valid payload wins (one repair retry each). |
| Everything else (`data_quality`, `feature_gap`, `navigation_wisdom`, `ask_user`, `form_fill`, `file_quality`, …) | `brain.parallel_providers` (`openai`, `perplexity`) parallel, arbitrated by `brain.default_arbiter` (`gemini`) | Council: both parallel members answer independently, then the arbiter receives both answers plus the original prompt and returns the single final JSON. |

Other relevant settings: `brain.timeout_seconds` (`60`, per-provider request
timeout; capped to 25s for vision calls and 45s for `plan`/`synthetic_data`),
`brain.agent_mode` (`template`, see [Run modes](#the-two-run-modes) below),
`brain.max_screens_per_session` (`60`, mirrored by the worker's own
`QA_MAX_SCREENS_PER_SESSION`). Provider failures are hard failures — the
ensemble never silently substitutes deterministic rules for an unavailable
or malformed model response.

## Key isolation

`GEMINI_API_KEY`, `OPENAI_API_KEY`, and `PERPLEXITY_API_KEY` (plus their
`_MODEL`/`_BASE_URL` companions) live only in `server-php/.env`. The worker
never sees them:

- The worker calls `POST /v1/worker/brain/invoke` (`WorkerController::brainInvoke`)
  for every AI decision — vision or text — and `GET /v1/worker/brain/health`
  (`WorkerController::brainHealth`) to pre-flight provider availability.
- `worker/brain/ensemble.ts` (`invokeBrain()`, `brainHealth()`) is the only
  place in the worker that talks to the QA API for AI calls; it forwards
  `task`, `system_prompt`, `user_prompt`, `context`, and optional `images`.
- `validateConfig()` in `worker/utils/config.ts` hard-fails worker startup if
  any of the three provider key env vars is present in the worker's own
  process environment — see `worker/.env.example` for the enforced rule.

## The two run modes

| Mode | Execution path | Behavior |
|------|----------------|----------|
| `template` (default) | `worker/runner/stepRunner.ts` | Today's deterministic step-by-step execution. Unchanged by this work. |
| `agent` | `worker/agent/agentLoop.ts` | Vision agent drives the browser one decision at a time instead of executing template steps. |

`resolveAgentMode()` in `worker/runner/sessionRunner.ts` decides per-session
which path runs:

```ts
function resolveAgentMode(payload: NextSessionPayload): 'agent' | 'template' {
  const contractHint = (payload.runtime_contract as unknown as Record<string, unknown> | null | undefined)?.['agent_mode']
  const payloadHint = (payload as unknown as Record<string, unknown>)['agent_mode']
  const hint = contractHint ?? payloadHint
  if (hint === 'agent' || hint === 'template') return hint
  return config.agentMode === 'agent' ? 'agent' : 'template'
}
```

`WorkerController::nextSession()` reads the `brain.agent_mode` setting and
puts it on `runtime_contract.agent_mode`, so editing it on the Settings page
takes effect for the *next* session claimed, with no worker restart or
redeploy needed. The top-level payload hint remains a secondary check for
forward-compatibility, and the worker's own `QA_AGENT_MODE` env var (default
`template`) is the final fallback — useful for local dev or older server
builds without a seeded `brain.agent_mode` row.

## The vision agent loop

`agentLoop.ts` runs a bounded loop (`budget` = `config.maxScreensPerSession`,
env `QA_MAX_SCREENS_PER_SESSION`, default 60 screens). Each iteration:

1. **Perceive** — `worker/agent/marks.ts` (`markInteractive()`) tags every
   interactive element on the page with a `data-qa-mark="N"` attribute
   (Set-of-Marks) and returns a structured `MarkDescriptor[]`; a marked
   viewport screenshot is captured for the vision call.
2. **Decide** — the marked screenshot plus a JSON prompt (goal, current URL,
   elements, scroll state, `suggested_path`, `capture_contract`,
   `captured_keys`/`missing_keys`, recent action history, and any stuck/scroll
   warnings) is sent to `invokeBrain('vision_agent', ...)`. The model must
   return JSON only, matching a strict decision contract:
   `{"observation":"", "reasoning":"", "action":{...}, "goal_progress":"", "blockers":[]}`.
3. **Act** — `worker/agent/actions.ts` (`executeAction()`) executes the
   decided `AgentAction`, one of:
   `click`, `type`, `select`, `press`, `scroll`, `navigate`, `wait`,
   `capture_table`, `done`, `blocked`, `ask_operator`. `capture_table`
   (`{mark, key}`) reads the `<table>` at that mark and writes rows into the
   session's shared `tables` map — the same map `stepRunner.ts` populates in
   template mode, so downstream validation code needs no changes.

Loop guards (all in `agentLoop.ts`):

- **Action budget** — the loop returns `status: 'budget'` once `budget`
  screens are exhausted.
- **Loop detection** (`evaluateLoopDetection()`) — tracks repeated
  action/signature triples and unchanged-page streaks; after 3 warnings the
  session ends `blocked`.
- **Scroll-stall warning** — after 3 consecutive scroll actions, the prompt
  tells the model to act on a control or explain precisely what's missing.
- **Blocked-refutation retry** (`evaluateBlockedDecision()`) — if the model
  claims a control doesn't exist but this session already clicked something
  with that label, or unscrolled page height remains, the loop refuses the
  `blocked` verdict once and sends the model back before accepting it.

## The capture contract

The core QA-specific design decision. `buildCaptureContract()` in
`sessionRunner.ts` builds a required-key list from the session template's
own `validations[]` rule codes plus the expected-result rows'
`metric_key`s, deduplicated:

```ts
function buildCaptureContract(template, expected: ExpectedRow[]): string[] {
  const fromValidations = template?.validations ?? []
  const fromExpected = expected.map((row) => row.metric_key)
  return [...new Set([...fromValidations, ...fromExpected])].filter(Boolean)
}
```

That list, plus the session template's own `steps[]` as a `suggested_path`
hint (never executed literally — just a default route, since a moved
control means the agent must find the equivalent one itself), is fed into
every decision prompt as `capture_contract` / `suggested_path`, alongside
`captured_keys` (current `Object.keys(tables)`) and `missing_keys`.

When the model returns `done` while `missing_keys` is non-empty,
`evaluateDoneDecision()` refuses it:

```ts
export function evaluateDoneDecision(input: { required: string[]; captured: string[]; refusalsUsed: number }): string | null {
  const missing = input.required.filter((key) => !input.captured.includes(key))
  if (!missing.length) return null
  if (input.refusalsUsed >= 2) return null
  return `The capture contract is not yet satisfied: still missing ${missing.join(', ')}. ...`
}
```

The agent gets **two free refusals** — on the third attempted `done` with
keys still missing, the loop ends with `status: 'contract_unmet'` instead of
`done`. `sessionRunner.ts` maps that onto a failing `AI_CAPTURE_CONTRACT`
validation result (`severity: 'high'`, `expected` = the joined contract
list), so an agent-mode session that never actually read the numbers under
test cannot silently report green — it must fail a named, reportable rule
instead.

## Perplexity's three roles

| Task | Purpose | Mode | Result handling |
|------|---------|------|------------------|
| `synthetic_data` | Suggests realistic form field values (`worker/data/syntheticData.ts`, called from `agentLoop.ts`'s `loadSuggestedValues()`) when a form has 3+ empty fillable fields. | Sequential, `brain.data_providers` (Perplexity first). | Values are offered to the model as `suggested_values`; the agent is not forced to use them. |
| `data_quality` | Root-cause analysis of failed validations (`worker/reviewer/dataQualityBrain.ts`, `runDataQualityReview()`), given captured tables, expected values, and which rules failed. | Council (`brain.parallel_providers` + arbiter). | **Enrichment only** — never throws; any failure resolves to `[]`. Findings are merged into the matching failed `ValidationResult.notes` via `mergeFindingsIntoPrompts()`, feeding the existing error-register fix-prompt pipeline without a schema change. |
| `feature_gap` | Competitive analysis: given heuristic feature gaps detected on-screen, prune false positives, rank by impact, add competitor references (`worker/reviewer/competitorComparison.ts`, `enrichGaps()`). | Council. | Gated behind `QA_FEATURE_GAP_ENABLED` (default off). Persisted via `POST /v1/worker/sessions/{id}/feature-gaps` into the `qa_feature_gaps` table (`FeatureGapsModel`). Enrichment only — never affects session pass/fail. |

## Logging

**`ai_step` events** — each agent decision is posted live via `postProgress()`
in `sessionRunner.ts`'s `onStep` callback as an `event_type: 'ai_step'`
progress event, with `metadata`: `action`, `outcome`, `outcome_observation`,
`observation`, `reasoning`, `goal_progress`, `blockers`, `guard`,
`target_label`, `typed_value`, `captured_key`, `signature_changed`,
`provider`, `model`, `latency_ms`, `usage`. These land in `qa_session_events`
via `WorkerController::progress()` / `recordEvent()`.

**Agent step timeline** — the full run is also persisted into
`result_json.agent_steps` on `postResult()` (`sessionRunner.ts`), one entry
per step: `ordinal`, `action`, `outcome`, `outcome_observation`,
`observation`, `reasoning`, `goal_progress`, `captured_key`,
`signature_changed`, `provider`, `model`, `latency_ms`. `ReportService.php`
reads `result_json.agent_steps` back out for both:

- the per-session HTML report's "AI Agent Timeline" section
  (`renderAgentStepsSection()`) — omitted entirely for template-mode sessions
  (no error, just nothing to render);
- the final consolidated report's one-line stat across the whole run
  (`renderAgentModeStat()` / `summariseAgentMode()`): how many sessions ran
  agent vs. template mode, and total agent screens taken.

**Live Log UI** — `web/src/components/SessionLiveLog.jsx` renders any event
with `event_type === 'ai_step'` as a dedicated `AiStepCard` (action/outcome
summary via `describeAiAction()`) instead of the generic progress-line
renderer used for everything else.

## Settings & rollback

The **Settings** page (`web/src/pages/Settings.jsx`, "AI Brain" section)
edits `brain.agent_mode`, `brain.vision_providers`, `brain.parallel_providers`,
`brain.data_providers`, `brain.default_arbiter`, `brain.timeout_seconds`, and
`brain.max_screens_per_session` via `GET`/`PUT /v1/settings`
(`SettingsController`), and shows live provider status from
`GET /v1/settings/brain-health` (`SettingsController::brainHealth()`, JWT-authenticated —
distinct from the worker-only `GET /v1/worker/brain/health`, so the browser
never needs the worker token).

**To roll back to fully-deterministic behavior**: set `brain.agent_mode =
template` in Settings — every session claimed after that takes effect
immediately, no worker restart needed. `QA_AGENT_MODE` on the worker remains
a local override/fallback only (see [The two run modes](#the-two-run-modes)).
No data, migration, or schema rollback is required either way; `agent_steps`
and `qa_feature_gaps` simply stay empty for template-mode runs.

## Safety guards unchanged by this work

These apply identically in both run modes — the vision agent calls the exact
same guard functions template-mode steps already used:

- **`isBlocked()`** (`worker/utils/safeActionGuard.ts`) — refuses clicks on
  destructive/statutory-filing controls (delete, approve, finalize, e-file,
  etc.), called from `actions.ts`'s `guardAction()` for `click`/Enter.
- **`isUnsafeToFill()`** (`worker/forms/unsafeFields.ts`) — refuses to type
  into credential, OTP, captcha, password, GSTIN/PAN/Aadhaar/bank/IFSC/CIN
  fields, called from `guardAction()` for `type`/`select`.
- **`evaluateHostGuard()`** (`worker/utils/hostGuard.ts`) — keeps the session
  on the target product's own host; used both for agent-mode `navigate`
  actions and for the explicit pre-agent-loop host check
  (`ensureProductHost()` in `sessionRunner.ts`, since agent mode never runs
  the template's `expect_product_host` step).
