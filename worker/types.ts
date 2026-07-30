/**
 * Shared TypeScript types for the dedicated Playwright QA worker.
 * Mirrors the JSON shape returned by /api/v1/worker/next-session.
 */

import type { Environment } from './utils/environments.js'

export type { Environment }

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'warning'
export type SessionStatus =
  | 'queued' | 'claimed' | 'running' | 'awaiting_decision'
  | 'completed' | 'failed' | 'skipped' | 'blocked_by_safe_guard' | 'partial'

export interface TargetProfile {
  id: number
  profile_name: string
  product_name: string
  /** Canonical five-tier value; legacy values are normalized on arrival. */
  environment: Environment | string
  base_url: string
  login_url: string
  username: string
  allowed_domains?: string[] | null
  allowed_modules?: string[] | null
  data_creation_allowed: boolean
  production_restriction: boolean
  observer_mode?: boolean
  read_only?: boolean
  allow_safe_demo?: boolean
  login_strategy?: string
  jump_to?: string | null
  extra_config?: Record<string, unknown> | null
  status: string
}

export interface Run {
  qa_run_id: string
  target_profile_id: number
  product_name: string
  environment: TargetProfile['environment']
  title?: string | null
  status: string
}

export interface Session {
  id: number
  qa_run_id: string
  name: string
  template_code: string | null
  module: string | null
  sub_module: string | null
  order_index: number
  scope_json?: Record<string, unknown> | null
  status: SessionStatus
}

export interface TemplateStep {
  kind: string
  [key: string]: unknown
}

export interface Template {
  code: string
  name: string
  product: string
  module: string
  sub_module?: string
  description?: string
  severity_on_fail?: Severity
  splittable?: boolean
  sub_modules?: string[]
  data_keys?: string[]
  steps: TemplateStep[]
  steps_by_env?: Record<string, TemplateStep[]>
  validations?: string[]
}

export interface RuntimeContract {
  login?: {
    jump_to_candidates?: string[]
    jump_to_selectors?: string[]
    selection_order?: string
  }
  post_login_host_guard?: {
    expected_base_url?: string
    allowed_domains?: string[]
    recovery?: string
    validation_rule?: string
  }
}

export interface ExpectedRow {
  id: number
  pack_id: number
  metric_key: string
  metric_label: string | null
  expected_value_json: Record<string, unknown>
  tolerance: number
}

export interface Pack {
  id: number
  product_name: string
  pack_name: string
  data_json: Record<string, unknown>
}

export interface ValidationRule {
  id: number
  rule_code: string
  rule_kind: 'accounting' | 'report' | 'ui' | 'workflow'
  title: string
  product_name?: string | null
  severity_on_fail: Severity
  expression_json: Record<string, unknown>
}

export interface NextSessionPayload {
  session: Session | null
  run?: Run
  profile?: TargetProfile
  template?: Template | null
  pack?: Pack | null
  expected?: ExpectedRow[]
  rules?: ValidationRule[]
  runtime_contract?: RuntimeContract | null
}

export interface ValidationResult {
  rule_code: string
  passed: boolean
  expected?: string
  actual?: string
  diff?: string
  severity: Severity
  notes?: string
}

export interface SessionPostBody {
  status: 'passed' | 'failed' | 'partial' | 'skipped'
  severity: Severity
  passed_count: number
  failed_count: number
  warning_count: number
  result_json: Record<string, unknown>
  screenshot_paths: string[]
  trace_path?: string | null
  console_errors: Array<{ type: string; text: string; location?: string; timestamp: string }>
  network_errors: Array<{ url: string; method: string; status?: number; error?: string; timestamp: string }>
  product_name?: string
  suggested_area?: string
  suggested_prompt?: string
  validations: ValidationResult[]
  started_at: string
  completed_at: string
}

export type FileIoCompareStatus =
  | 'pass' | 'fail' | 'partial' | 'skipped' | 'blocked' | 'not_applicable'

/** Body posted to POST /v1/worker/sessions/{id}/file-io. */
export interface FileIoTestPayload {
  scenario_key: string
  direction: 'upload' | 'download' | 'round_trip'
  fixture_name?: string
  upload_ok: boolean
  download_ok: boolean
  compare_status: FileIoCompareStatus
  source_sha256?: string
  result_sha256?: string
  source_mime?: string
  result_mime?: string
  source_bytes?: number
  result_bytes?: number
  structure_ok: boolean
  structure_notes?: string
  rows_expected?: number
  rows_found?: number
  mismatched_cells?: number
  mismatches?: Array<{ key: string; column: string; expected: string; actual: string }>
  totals_expected?: Record<string, number>
  totals_found?: Record<string, number>
  data_verified?: boolean | null
  verification_notes?: string
  artifact_paths: Record<string, string>
  evidence: Record<string, unknown>
}

export interface DecisionOption {
  id: string
  label: string
  recommended?: boolean
  action?: string
  [key: string]: unknown
}

export interface DecisionRow {
  id: number
  status: string
  selected_option?: string | null
  options_json?: DecisionOption[]
  situation_key?: string
  question?: string
  source?: string
  remember?: boolean
}
