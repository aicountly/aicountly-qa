/**
 * `data_quality` council task: given the tables the run actually captured, the
 * expected values, and which validation rules failed, ask the AI council for
 * a likely root cause and what a developer should check first. Enrichment
 * only — never allowed to fail a session, so any error (including
 * BrainUnavailableError) resolves to an empty findings list.
 */

import { BrainUnavailableError, invokeBrain } from '../brain/ensemble.js'
import type { ExpectedRow, ValidationResult } from '../types.js'

export interface Finding {
  rule_code: string
  likely_cause: string
  confidence: 'high' | 'medium' | 'low'
  check_next: string
  implicated_table: string
}

export interface DataQualityReviewInput {
  tables: Record<string, Array<Record<string, string>>>
  expected: ExpectedRow[]
  validations: ValidationResult[]
  product: string
  environment: string
  sessionName: string
}

const MAX_ROWS_PER_TABLE = 20

export async function runDataQualityReview(input: DataQualityReviewInput): Promise<Finding[]> {
  const failed = input.validations.filter((v) => !v.passed)
  if (failed.length === 0) return []

  const systemPrompt = 'You are an AICOUNTLY accounting/data-quality analyst. Given captured '
    + 'on-screen tables, the expected values, and which validation rules failed, explain the '
    + 'most likely root cause (e.g. wrong GST rate applied, rounding difference, missing ledger '
    + 'posting, wrong period) and suggest what a developer should check first. Be specific about '
    + 'which table/field is implicated. Output JSON only: {"findings":[{"rule_code":"",'
    + '"likely_cause":"","confidence":"high|medium|low","check_next":"","implicated_table":""}]}.'

  const userPrompt = JSON.stringify({
    product: input.product,
    environment: input.environment,
    session: input.sessionName,
    failed_validations: failed,
    tables: trimTables(input.tables),
    expected: input.expected,
  })

  try {
    const r = await invokeBrain('data_quality', systemPrompt, userPrompt, {
      product: input.product,
      environment: input.environment,
    })
    return parseFindings(r.final)
  } catch (e) {
    if (e instanceof BrainUnavailableError) {
      console.warn('[aicountly-qa-worker] data-quality review skipped: brain unavailable —', e.message)
    } else {
      console.warn('[aicountly-qa-worker] data-quality review skipped:', (e as Error)?.message ?? String(e))
    }
    return []
  }
}

/**
 * Appends AI findings as free-text onto the matching failed ValidationResult's
 * `notes`, so the enrichment flows into the existing qa_error_register
 * fix-prompt pipeline without a schema change. Output type is exactly
 * ValidationResult[] — same shape, richer `notes` string only.
 */
export function mergeFindingsIntoPrompts(validations: ValidationResult[], findings: Finding[]): ValidationResult[] {
  if (findings.length === 0) return validations

  const byRule = new Map<string, Finding>()
  for (const f of findings) {
    if (!byRule.has(f.rule_code)) byRule.set(f.rule_code, f)
  }

  return validations.map((v) => {
    if (v.passed) return v
    const finding = byRule.get(v.rule_code)
    if (!finding) return v
    const suffix = `AI: ${finding.likely_cause} (check: ${finding.check_next})`
    return { ...v, notes: v.notes ? `${v.notes} | ${suffix}` : suffix }
  })
}

function trimTables(
  tables: Record<string, Array<Record<string, string>>>,
): Record<string, Array<Record<string, string>>> {
  const out: Record<string, Array<Record<string, string>>> = {}
  for (const [key, rows] of Object.entries(tables)) {
    out[key] = rows.slice(0, MAX_ROWS_PER_TABLE)
  }
  return out
}

function parseFindings(output: unknown): Finding[] {
  const raw = Array.isArray(output)
    ? output
    : (output && typeof output === 'object' ? (output as { findings?: unknown }).findings : null)
  if (!Array.isArray(raw)) return []

  const findings: Finding[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const ruleCode = String(record.rule_code ?? '').trim()
    const likelyCause = String(record.likely_cause ?? '').trim()
    if (!ruleCode || !likelyCause) continue

    const confidenceRaw = String(record.confidence ?? '').trim().toLowerCase()
    const confidence: Finding['confidence'] = confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : 'low'

    findings.push({
      rule_code: ruleCode,
      likely_cause: likelyCause,
      confidence,
      check_next: String(record.check_next ?? '').trim(),
      implicated_table: String(record.implicated_table ?? '').trim(),
    })
  }
  return findings
}
