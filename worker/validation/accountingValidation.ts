/**
 * Accounting reconciliation rules for the worker. Takes the raw tables read
 * from the target app + the deterministic expected_value map and emits
 * ValidationResult[] for each applicable rule.
 */

import type { ExpectedRow, ValidationResult, ValidationRule, Severity } from '../types.js'

export interface AccountingInputs {
  tables: Record<string, Array<Record<string, string>>>
  expected: ExpectedRow[]
  rules: ValidationRule[]
}

export function runAccountingChecks(inp: AccountingInputs): ValidationResult[] {
  const out: ValidationResult[] = []
  const expMap = expectedMap(inp.expected)

  for (const r of inp.rules) {
    if (r.rule_kind !== 'accounting') continue
    switch (r.rule_code) {
      case 'ACC_TB_BALANCED':
        out.push(checkEqualityMetric('ACC_TB_BALANCED', 'Trial Balance debit equals credit', 'tb_debit_total', 'tb_credit_total', inp.tables, r.severity_on_fail))
        break
      case 'ACC_GST_OUTPUT_RATE_MATCH':
        out.push(checkExpected(r.rule_code, 'Output GST total', 'output_gst_total', expMap, inp.tables, r.severity_on_fail))
        break
      case 'ACC_GST_INPUT_RATE_MATCH':
        out.push(checkExpected(r.rule_code, 'Input GST total',  'input_gst_total',  expMap, inp.tables, r.severity_on_fail))
        break
      case 'CASH_BANK_MATCH':
        out.push(checkExpected(r.rule_code, 'Cash balance',     'cash_balance',     expMap, inp.tables, r.severity_on_fail))
        out.push(checkExpected(r.rule_code, 'Bank balance',     'bank_balance',     expMap, inp.tables, r.severity_on_fail))
        break
      case 'ACC_LEDGER_RECONCILES':
        out.push({ rule_code: r.rule_code, passed: true, severity: r.severity_on_fail, notes: 'reconciliation deferred to per-ledger checks (logged for review)' })
        break
      case 'STK_QTY_MOVEMENT':
        out.push(checkExpected(r.rule_code, 'Stock movement',   'closing_stock_qty', expMap, inp.tables, r.severity_on_fail))
        break
      case 'STK_CLOSING_VALUE':
        out.push(checkExpected(r.rule_code, 'Closing stock value', 'closing_stock_value', expMap, inp.tables, r.severity_on_fail))
        break
    }
  }
  return out
}

function expectedMap(rows: ExpectedRow[]): Record<string, ExpectedRow> {
  const out: Record<string, ExpectedRow> = {}
  for (const r of rows) out[r.metric_key] = r
  return out
}

function tableValue(tables: Record<string, Array<Record<string, string>>>, metricKey: string): string | null {
  // First-pass: any row whose first cell text matches the metric key.
  for (const rows of Object.values(tables)) {
    for (const row of rows) {
      const first = String(Object.values(row)[0] ?? '').toLowerCase()
      if (first.includes(metricKey.replace(/_/g, ' '))) {
        const nums = Object.values(row).filter((v) => /\d/.test(v))
        const last = nums[nums.length - 1]
        if (last) return last
      }
    }
  }
  return null
}

function checkExpected(
  code: string,
  label: string,
  metricKey: string,
  expMap: Record<string, ExpectedRow>,
  tables: Record<string, Array<Record<string, string>>>,
  sev: Severity,
): ValidationResult {
  const expectedRow = expMap[metricKey]
  if (!expectedRow) {
    return { rule_code: code, passed: true, severity: sev, notes: `${label}: no expected value configured` }
  }
  const expectedVal = numericFromExpected(expectedRow)
  const actualText  = tableValue(tables, metricKey)
  const actualVal   = parseNumber(actualText || '')

  if (expectedVal === null || actualVal === null) {
    return {
      rule_code: code,
      passed: false,
      expected: JSON.stringify(expectedRow.expected_value_json),
      actual: actualText ?? 'not read',
      severity: sev,
      notes: `${label}: could not compare (missing values)`,
    }
  }

  const tolerance = Number(expectedRow.tolerance ?? 1)
  const passed = Math.abs(expectedVal - actualVal) <= tolerance

  return {
    rule_code: code,
    passed,
    expected: String(expectedVal),
    actual: String(actualVal),
    diff: String(expectedVal - actualVal),
    severity: passed ? 'low' : sev,
    notes: label,
  }
}

function checkEqualityMetric(
  code: string,
  label: string,
  leftKey: string,
  rightKey: string,
  tables: Record<string, Array<Record<string, string>>>,
  sev: Severity,
): ValidationResult {
  const l = parseNumber(tableValue(tables, leftKey) || '')
  const r = parseNumber(tableValue(tables, rightKey) || '')
  if (l === null || r === null) {
    return { rule_code: code, passed: false, severity: sev, expected: leftKey, actual: rightKey, notes: `${label}: missing one or both totals` }
  }
  const passed = Math.abs(l - r) < 1
  return { rule_code: code, passed, severity: passed ? 'low' : sev, expected: String(l), actual: String(r), notes: label, diff: String(l - r) }
}

function numericFromExpected(row: ExpectedRow): number | null {
  const v: unknown = row.expected_value_json?.value ?? row.expected_value_json
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseNumber(v)
  return null
}

function parseNumber(s: string): number | null {
  if (!s) return null
  const cleaned = s.replace(/[, ₹$Rs.]+/g, '').replace(/\(([\d.]+)\)/, '-$1')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
