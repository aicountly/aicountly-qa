/**
 * Shared TypeScript types for the Playwright QA worker.
 * Mirrors the JSON shape returned by /api/v1/worker/next-session.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'warning'
export type SessionStatus =
  | 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked_by_safe_guard'

export interface TargetProfile {
  id: number
  profile_name: string
  product_name: string
  environment: 'sandbox' | 'gh' | 'prod_basic' | 'prod_full'
  base_url: string
  login_url: string
  username: string
  allowed_domains?: string[] | null
  allowed_modules?: string[] | null
  data_creation_allowed: boolean
  production_restriction: boolean
  status: string
}

export interface Run {
  qa_run_id: string
  target_profile_id: number
  product_name: string
  environment: TargetProfile['environment']
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
  validations?: string[]
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
