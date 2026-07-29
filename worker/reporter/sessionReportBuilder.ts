/**
 * Builds the per-session HTML + JSON report locally (in addition to the API's
 * version). Worker-side report is generated even if the API call fails so we
 * always retain evidence on disk.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Session, Run, ValidationResult, Severity } from '../types.js'
import type { ConsoleEntry } from '../capture/consoleCapture.js'
import type { NetworkEntry } from '../capture/networkCapture.js'
import type { StepResult } from '../runner/stepRunner.js'

export interface SessionReportInputs {
  dir: string
  session: Session
  run: Run
  steps: StepResult[]
  validations: ValidationResult[]
  screenshots: string[]
  tracePath: string | null
  console: ConsoleEntry[]
  network: NetworkEntry[]
  startedAt: string
  completedAt: string
}

export interface SessionReportOutputs {
  status: 'passed' | 'failed' | 'partial' | 'skipped'
  severity: Severity
  passed: number
  failed: number
  warnings: number
  htmlPath: string
  jsonPath: string
  suggested_area: string
  suggested_prompt: string
}

export async function buildSessionReport(inp: SessionReportInputs): Promise<SessionReportOutputs> {
  await mkdir(inp.dir, { recursive: true })

  const failedValidations = inp.validations.filter((v) => !v.passed)
  const failedSteps       = inp.steps.filter((s) => !s.ok)
  const warnings          = inp.validations.filter((v) => v.passed && v.severity === 'warning').length

  const status: 'passed' | 'failed' | 'partial' | 'skipped' =
    failedValidations.length === 0 && failedSteps.length === 0
      ? 'passed'
      : (failedValidations.length > 0 && inp.validations.length > failedValidations.length ? 'partial' : 'failed')

  const severity = topSeverity(failedValidations)
  const suggested_area = suggestArea(inp.session.module, failedValidations, failedSteps)
  const suggested_prompt = suggestPrompt(inp.session, failedValidations, failedSteps)

  const json = {
    qa_run_id: inp.session.qa_run_id,
    session: inp.session,
    run: inp.run,
    status,
    severity,
    started_at: inp.startedAt,
    completed_at: inp.completedAt,
    counts: {
      passed_checks: inp.validations.filter((v) => v.passed).length,
      failed_checks: failedValidations.length,
      warnings,
      total_steps: inp.steps.length,
      failed_steps: failedSteps.length,
    },
    tested_screens: Array.from(new Set(inp.steps.filter((s) => s.kind === 'navigate_menu').map((s) => s.detail).filter(Boolean))),
    steps: inp.steps,
    validations: inp.validations,
    expected_vs_actual: failedValidations.map((v) => ({
      rule: v.rule_code, expected: v.expected, actual: v.actual, diff: v.diff, notes: v.notes,
    })),
    screenshots: inp.screenshots,
    trace_path: inp.tracePath,
    console_errors: inp.console.filter((c) => c.type === 'error' || c.type === 'pageerror'),
    network_errors: inp.network,
    likely_affected_module: inp.session.module,
    suggested_developer_area: suggested_area,
    suggested_developer_prompt: suggested_prompt,
  }

  const jsonPath = join(inp.dir, 'report.json')
  const htmlPath = join(inp.dir, 'report.html')

  await writeFile(jsonPath, JSON.stringify(json, null, 2))
  await writeFile(htmlPath, renderHtml(json))

  return {
    status,
    severity,
    passed: json.counts.passed_checks,
    failed: json.counts.failed_checks,
    warnings: warnings,
    htmlPath,
    jsonPath,
    suggested_area,
    suggested_prompt,
  }
}

function topSeverity(failed: ValidationResult[]): Severity {
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'warning']
  for (const sev of order) if (failed.some((f) => f.severity === sev)) return sev
  return 'low'
}

function suggestArea(module: string | null, failedV: ValidationResult[], failedS: StepResult[]): string {
  if (!failedV.length && !failedS.length) return ''
  const sources = [
    module ?? '',
    failedV.map((v) => v.rule_code).join(','),
    failedS.map((s) => s.kind).join(','),
  ].filter(Boolean)
  return `Likely area: ${module ?? 'unknown'} module. Check controller / model / view for rules: ${failedV.map((v) => v.rule_code).join(', ')}.`
}

function suggestPrompt(session: Session, failedV: ValidationResult[], failedS: StepResult[]): string {
  if (!failedV.length && !failedS.length) return ''
  const parts = [
    `In the ${session.module ?? 'target'} module of the AICOUNTLY app under test,`,
    failedV.length ? `the following QA rules failed: ${failedV.map((v) => v.rule_code).join(', ')}.` : '',
    failedS.length ? `${failedS.length} workflow steps did not complete (${failedS.map((s) => s.kind).join(', ')}).` : '',
    'Investigate the relevant controller, service, query and UI component to identify the discrepancy.',
    'Do NOT take any code action inside the QA portal — fixes belong in the target app repo.',
  ].filter(Boolean)
  return parts.join(' ')
}

function renderHtml(json: Record<string, unknown>): string {
  const session = (json.session ?? {}) as Record<string, unknown>
  const validations = (json.validations ?? []) as ValidationResult[]
  const screenshots = (json.screenshots ?? []) as string[]
  const consoleErrors = (json.console_errors ?? []) as ConsoleEntry[]
  const networkErrors = (json.network_errors ?? []) as NetworkEntry[]
  const expVsAct = (json.expected_vs_actual ?? []) as Array<Record<string, unknown>>

  return shell(
    `QA Session — ${session.name ?? ''}`,
    `
    <header>
      <h1>QA Session Report</h1>
      <p class="muted">${escapeHtml(String(json.qa_run_id))} · ${escapeHtml(String(session.module ?? ''))} · ${escapeHtml(String(session.sub_module ?? ''))}</p>
      <h2>${escapeHtml(String(session.name ?? ''))}</h2>
      <p>Status: <span class="badge status-${escapeHtml(String(json.status))}">${escapeHtml(String(json.status))}</span> · Severity: <span class="badge sev-${escapeHtml(String(json.severity))}">${escapeHtml(String(json.severity))}</span></p>
    </header>

    <h3>Validations</h3>
    <table>
      <thead><tr><th>Result</th><th>Rule</th><th>Severity</th><th>Expected</th><th>Actual</th><th>Notes</th></tr></thead>
      <tbody>
        ${validations.map((v) => `
          <tr class="${v.passed ? 'pass' : 'fail'}">
            <td>${v.passed ? 'PASS' : 'FAIL'}</td>
            <td class="mono">${escapeHtml(v.rule_code)}</td>
            <td><span class="badge sev-${v.severity}">${v.severity}</span></td>
            <td class="mono">${escapeHtml(v.expected ?? '')}</td>
            <td class="mono">${escapeHtml(v.actual ?? '')}</td>
            <td>${escapeHtml(v.notes ?? '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${expVsAct.length ? `
      <h3>Expected vs Actual</h3>
      <table>
        <thead><tr><th>Rule</th><th>Expected</th><th>Actual</th><th>Diff</th></tr></thead>
        <tbody>
          ${expVsAct.map((d) => `
            <tr class="fail"><td class="mono">${escapeHtml(String(d.rule))}</td><td class="mono">${escapeHtml(String(d.expected ?? ''))}</td><td class="mono">${escapeHtml(String(d.actual ?? ''))}</td><td class="mono">${escapeHtml(String(d.diff ?? ''))}</td></tr>
          `).join('')}
        </tbody>
      </table>` : ''}

    ${screenshots.length ? `
      <h3>Screenshots (${screenshots.length})</h3>
      <ul class="paths">${screenshots.map((p) => `<li class="mono">${escapeHtml(p)}</li>`).join('')}</ul>` : ''}

    ${consoleErrors.length ? `
      <h3>Console errors (${consoleErrors.length})</h3>
      <pre>${escapeHtml(JSON.stringify(consoleErrors, null, 2))}</pre>` : ''}

    ${networkErrors.length ? `
      <h3>Network errors (${networkErrors.length})</h3>
      <pre>${escapeHtml(JSON.stringify(networkErrors, null, 2))}</pre>` : ''}

    ${json.suggested_developer_area ? `
      <h3>Suggested developer area</h3>
      <p>${escapeHtml(String(json.suggested_developer_area))}</p>
      <h3>Suggested developer prompt</h3>
      <pre>${escapeHtml(String(json.suggested_developer_prompt))}</pre>` : ''}
    `,
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c)
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
:root{--g:#16a34a;--g50:#f0fdf4;--ink:#111;--mid:#555;--mut:#888;--line:#e5e7eb;--red:#dc2626;--ylw:#d97706}
*{box-sizing:border-box}html,body{margin:0;background:#fff;color:var(--ink);font:14px/1.5 Inter,system-ui,Arial,sans-serif}
.container{max-width:1100px;margin:0 auto;padding:32px 24px}
h1{font-size:22px;margin:0 0 4px}h2{margin:6px 0;color:var(--g);font-size:18px}h3{margin:24px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
.badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;background:var(--g50);color:var(--g);font-weight:600}
.badge.status-failed,.badge.sev-critical{background:#fef2f2;color:var(--red)}.badge.sev-high,.badge.status-partial{background:#fff7ed;color:var(--ylw)}.badge.sev-warning{background:#fff7ed;color:var(--ylw)}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);font-size:13px}th{background:var(--g50);color:var(--g);font-weight:600}
tr.fail td{background:#fef2f2}tr.pass td{background:#fff}
.mono{font-family:ui-monospace,Menlo,monospace}
.paths{list-style:none;padding:0;margin:8px 0;font-size:12px}
.paths li{padding:4px 8px;background:#f9fafb;border-radius:4px;margin-bottom:4px;color:var(--mid)}
pre{background:#0b1020;color:#e2e8f0;padding:12px;border-radius:6px;overflow:auto;font-size:12px}
.muted{color:var(--mut);font-size:13px}
footer{margin-top:48px;color:#888;font-size:11px}
</style></head><body><div class="container">${body}<footer>AICOUNTLY QA Portal — testing &amp; reporting only.</footer></div></body></html>`
}
