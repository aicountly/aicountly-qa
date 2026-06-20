/**
 * Orchestrates one QA session end-to-end:
 *   load template → start tracing → attach console/network capture →
 *   login → company/branch/FY context → run steps via stepRunner →
 *   capture validations → write session report → post result + uploads.
 */

import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright'

import { fetchNextSession, heartbeat, postResult, uploadEvidence } from '../apiClient.js'
import { loginToTarget } from '../auth/login.js'
import { selectOrCreateCompany } from '../context/companyContext.js'
import { selectOrCreateBranch } from '../context/branchContext.js'
import { selectOrCreateFinancialYear } from '../context/financialYearContext.js'
import { ConsoleCapture } from '../capture/consoleCapture.js'
import { NetworkCapture } from '../capture/networkCapture.js'
import { ScreenshotCapture } from '../capture/screenshotCapture.js'
import { TraceCapture } from '../capture/traceCapture.js'
import { preparePack } from '../data/testDataEngine.js'
import { buildSessionReport } from '../reporter/sessionReportBuilder.js'
import { runStep, type StepResult } from './stepRunner.js'
import { runAccountingChecks } from '../validation/accountingValidation.js'
import { runReportChecks } from '../validation/reportValidation.js'
import { runUiChecks } from '../validation/uiValidation.js'
import { config } from '../utils/config.js'
import { interpolate, dateFromRunId } from '../utils/runId.js'
import { SafeActionBlocked } from '../utils/safeActionGuard.js'
import type { NextSessionPayload, ValidationResult, SessionPostBody, Severity } from '../types.js'

interface RunOpts {
  basicCheck?: boolean
}

export async function runOneSession(payload: NextSessionPayload, opts: RunOpts = {}): Promise<boolean> {
  if (!payload.session) return false
  const { session, run, profile, template, pack, expected = [], rules = [] } = payload
  if (!run || !profile) {
    throw new Error('next-session payload missing run or profile')
  }

  const startedAt = new Date().toISOString()
  const date = dateFromRunId(session.qa_run_id) ?? new Date().toISOString().slice(0, 10)
  const dir = resolve(
    process.cwd(),
    config.reportsDir,
    profile.product_name,
    date,
    session.qa_run_id,
    `session-${String(session.order_index).padStart(3, '0')}-${slug(session.name)}`,
  )
  await mkdir(dir, { recursive: true })

  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMo })
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } })

  const screenshots = new ScreenshotCapture(dir)
  const trace = new TraceCapture(dir)
  const consoleCap = new ConsoleCapture()
  const netCap = new NetworkCapture()

  await trace.start(ctx)

  const page = await ctx.newPage()
  consoleCap.attach(page)
  netCap.attach(page)

  const guard = {
    environment: profile.environment,
    productionUnlocked: false, // future: surface from settings via API
  }

  const heart = setInterval(() => { void heartbeat(session.id).catch(() => null) }, config.heartbeatMs)

  const data = preparePack(pack).forRun(session.qa_run_id)
  const tables: Record<string, Array<Record<string, string>>> = {}
  const stepResults: StepResult[] = []
  let blockedBySafeGuard = false
  let safeGuardMessage = ''

  try {
    // Login + context — except for basic-check production mode which skips writes.
    await loginToTarget(page, profile)
    await screenshots.take(page, 'after-login')

    if (!opts.basicCheck) {
      const company = (data['company'] as { name: string } | undefined)?.name
      if (company) await selectOrCreateCompany(page, company)

      const branch = (data['branch'] as { name: string } | undefined)?.name
      if (branch) await selectOrCreateBranch(page, branch)

      const fy = data['financial_year'] as { name: string; start: string; end: string } | undefined
      if (fy) await selectOrCreateFinancialYear(page, fy)
    }
    await screenshots.take(page, 'after-context')

    // Execute template steps.
    const steps = template?.steps ? interpolate(template.steps, session.qa_run_id, {
      login_url: profile.login_url,
      base_url:  profile.base_url,
      username:  profile.username,
      password:  '*encrypted*',
      fy_start:  (data['financial_year'] as { start: string } | undefined)?.start ?? '',
      fy_end:    (data['financial_year'] as { end: string }   | undefined)?.end   ?? '',
    }) : []

    let stepIdx = 0
    for (const stRaw of steps as Array<Record<string, unknown>>) {
      // Hydrate any "{ items: '{ledgers}' }" placeholders into actual data arrays.
      const st = hydrateItems(stRaw, data)
      try {
        const r = await runStep(st, ++stepIdx, { page, guard, tables, qaRunId: session.qa_run_id })
        stepResults.push(r)
        if (!r.ok) {
          await screenshots.take(page, `step-${stepIdx}-failed`)
        }
      } catch (err) {
        if (err instanceof SafeActionBlocked) {
          blockedBySafeGuard = true
          safeGuardMessage = err.message
          stepResults.push({ index: stepIdx, kind: st.kind as string, ok: false, error: err.message })
          await screenshots.take(page, `step-${stepIdx}-safeguard-blocked`)
          break
        }
        stepResults.push({ index: stepIdx, kind: st.kind as string, ok: false, error: (err as Error)?.message ?? String(err) })
        await screenshots.take(page, `step-${stepIdx}-error`)
      }
    }
    await screenshots.take(page, 'final-state')
  } catch (err) {
    stepResults.push({ index: 0, kind: 'fatal', ok: false, error: (err as Error)?.message ?? String(err) })
  } finally {
    clearInterval(heart)
  }

  const tracePath = await trace.stop(ctx).catch(() => null)
  await ctx.close().catch(() => null)
  await browser.close().catch(() => null)

  // Run validation engines.
  const acc = runAccountingChecks({ tables, expected, rules })
  const rep = runReportChecks({ tables, expected, rules })
  const ui  = runUiChecks({
    console: consoleCap.all(),
    network: netCap.errors(),
    steps: stepResults,
    rules,
  })

  let validations: ValidationResult[] = [...acc, ...rep, ...ui]

  if (blockedBySafeGuard) {
    validations = [
      { rule_code: 'SAFE_ACTION_GUARD', passed: false, severity: 'critical' as Severity, notes: safeGuardMessage },
      ...validations,
    ]
  }

  const completedAt = new Date().toISOString()
  const report = await buildSessionReport({
    dir,
    session,
    run,
    steps: stepResults,
    validations,
    screenshots: screenshots.paths(),
    tracePath,
    console: consoleCap.all(),
    network: netCap.errors(),
    startedAt,
    completedAt,
  })

  const body: SessionPostBody = {
    status: blockedBySafeGuard ? 'skipped' : report.status,
    severity: report.severity,
    passed_count: report.passed,
    failed_count: report.failed,
    warning_count: report.warnings,
    result_json: {
      tested_screens: Array.from(new Set(stepResults.filter((s) => s.kind === 'navigate_menu').map((s) => s.detail).filter(Boolean))),
      data_entered_keys: template?.data_keys ?? [],
      workflow_steps: stepResults.length,
      tables_read: Object.keys(tables),
      blocked_by_safe_guard: blockedBySafeGuard,
    },
    screenshot_paths: screenshots.paths(),
    trace_path: tracePath,
    console_errors: consoleCap.all(),
    network_errors: netCap.errors(),
    product_name: profile.product_name,
    suggested_area: report.suggested_area,
    suggested_prompt: report.suggested_prompt,
    validations,
    started_at: startedAt,
    completed_at: completedAt,
  }

  // Post result + upload evidence to API (best-effort; we already wrote local files).
  try {
    await postResult(session.id, body)
    for (const p of screenshots.paths()) {
      await uploadEvidence(session.id, p, 'screenshot').catch(() => null)
    }
    if (tracePath) await uploadEvidence(session.id, tracePath, 'trace').catch(() => null)
    await uploadEvidence(session.id, report.htmlPath, 'html').catch(() => null)
    await uploadEvidence(session.id, report.jsonPath, 'json').catch(() => null)
  } catch (err) {
    // The local files are still on disk; surface error to the operator log.
    console.error('[worker] postResult failed:', (err as Error)?.message)
  }

  return true
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function hydrateItems(step: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...step }
  if (typeof step.items === 'string') {
    const m = (step.items as string).match(/^\{(\w+)\}$/)
    if (m && data[m[1]]) out.items = data[m[1]]
  }
  return out
}

export { fetchNextSession }
