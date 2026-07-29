/**
 * UI / workflow validation rules derived from console + network capture +
 * step results. Pure functions on already-collected evidence.
 */

import type { ValidationResult, ValidationRule } from '../types.js'
import type { ConsoleEntry } from '../capture/consoleCapture.js'
import type { NetworkEntry } from '../capture/networkCapture.js'
import type { StepResult } from '../runner/stepRunner.js'

export interface UiInputs {
  console: ConsoleEntry[]
  network: NetworkEntry[]
  steps: StepResult[]
  rules: ValidationRule[]
  themeObserved?: { bg: string; color: string; legacyHits: string[] }
}

export function runUiChecks(inp: UiInputs): ValidationResult[] {
  const out: ValidationResult[] = []

  for (const r of inp.rules) {
    if (r.rule_kind !== 'ui' && r.rule_kind !== 'workflow') continue

    switch (r.rule_code) {
      case 'UI_NO_CRITICAL_CONSOLE': {
        const errs = inp.console.filter((c) => c.type === 'error' || c.type === 'pageerror')
        out.push({
          rule_code: r.rule_code,
          passed: errs.length === 0,
          severity: errs.length === 0 ? 'low' : r.severity_on_fail,
          expected: '0',
          actual: String(errs.length),
          notes: errs.length === 0 ? 'no console errors' : (errs[0]?.text ?? ''),
        })
        break
      }
      case 'UI_NO_UNHANDLED_API': {
        const fails = inp.network.filter((n) => (n.status && n.status >= 400) || n.error)
        out.push({
          rule_code: r.rule_code,
          passed: fails.length === 0,
          severity: fails.length === 0 ? 'low' : r.severity_on_fail,
          expected: '0',
          actual: String(fails.length),
          notes: fails.length === 0 ? 'no failed API calls' : `${fails[0]?.method} ${fails[0]?.url} → ${fails[0]?.status ?? fails[0]?.error}`,
        })
        break
      }
      case 'UI_NO_BLANK_PAGE': {
        const blanks = inp.steps.filter((s) => s.kind === 'expect_visible' && !s.ok)
        out.push({
          rule_code: r.rule_code,
          passed: blanks.length === 0,
          severity: blanks.length === 0 ? 'low' : r.severity_on_fail,
          notes: blanks.length === 0 ? 'all expected elements visible' : `${blanks.length} blank/missing elements`,
        })
        break
      }
      case 'UI_REQUIRED_FIELDS':
      case 'UI_SAVE_WORKS':
      case 'UI_CANCEL_WORKS':
      case 'UI_SEARCH_WORKS':
      case 'UI_KEYBOARD_FLOW':
      case 'CTX_PERSISTENCE':
      case 'DATE_FILTER_WORKS': {
        const failed = inp.steps.filter((s) => !s.ok && rulesForKinds(r.rule_code).includes(s.kind))
        out.push({
          rule_code: r.rule_code,
          passed: failed.length === 0,
          severity: failed.length === 0 ? 'low' : r.severity_on_fail,
          notes: failed.length === 0 ? 'no related failures' : `${failed.length} step failure(s)`,
        })
        break
      }
      case 'UI_OLD_THEME_DETECTED': {
        const hits = inp.themeObserved?.legacyHits ?? []
        out.push({
          rule_code: r.rule_code,
          passed: hits.length === 0,
          severity: hits.length === 0 ? 'low' : r.severity_on_fail,
          notes: hits.length === 0 ? 'no legacy classes detected' : `legacy classes: ${hits.join(', ')}`,
        })
        break
      }
      case 'UI_GREEN_WHITE_THEME': {
        const obs = inp.themeObserved
        const ok = !!obs && (obs.bg.includes('255') || obs.bg.includes('rgb(255'))
        out.push({
          rule_code: r.rule_code,
          passed: ok,
          severity: ok ? 'low' : r.severity_on_fail,
          notes: ok ? 'background appears white' : `background observed: ${obs?.bg ?? 'unknown'}`,
        })
        break
      }
    }
  }
  return out
}

function rulesForKinds(code: string): string[] {
  switch (code) {
    case 'UI_REQUIRED_FIELDS': return ['fill', 'select', 'expect_toast']
    case 'UI_SAVE_WORKS':      return ['click', 'expect_toast']
    case 'UI_CANCEL_WORKS':    return ['click']
    case 'UI_SEARCH_WORKS':    return ['search', 'expect_row']
    case 'UI_KEYBOARD_FLOW':   return ['keyboard_flow']
    case 'CTX_PERSISTENCE':    return ['navigate_menu', 'expect_visible']
    case 'DATE_FILTER_WORKS':  return ['apply_date_filter']
    default: return []
  }
}
