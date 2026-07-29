/**
 * Orchestrates one QA session end-to-end for the dedicated aicountly-qa-worker.
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

import { fetchCredentials, fetchNextSession, heartbeat, postProgress, postResult, uploadEvidence } from '../apiClient.js'
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
import type { NextSessionPayload, ValidationResult, SessionPostBody, Severity, TemplateStep } from '../types.js'

interface RunOpts {
  basicCheck?: boolean
}

export async function runOneSession(payload: NextSessionPayload, opts: RunOpts = {}): Promise<boolean> {
  if (!payload.session) return false
  const { session, run, profile, template, pack, expected = [], rules = [], runtime_contract } = payload
  if (!run || !profile) {
    throw new Error('next-session payload missing run or profile')
  }

  const startedAt = new Date().toISOString()
  const date = dateFromRunId(session.qa_run_id) ?? new Date().toISOString().slice(0, 10)
  const dir = resolve(
    config.reportsDir,
    profile.product_name,
    date,
    session.qa_run_id,
    `session-${String(session.order_index).padStart(3, '0')}-${slug(session.name)}`,
  )
  await mkdir(dir, { recursive: true })

  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMo })
  const ctx = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1366, height: 900 },
    userAgent: 'AICountlyQABot/0.2 (+aicountly-qa-worker)',
  })

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
    productionUnlocked: false,
  }

  const heart = setInterval(() => {
    void heartbeat(session.id, {
      message: `Lease heartbeat from ${config.workerId}`,
      metadata: { worker: config.packageName },
    }).catch(() => null)
  }, config.heartbeatMs)

  const data = preparePack(pack).forRun(session.qa_run_id)
  const tables: Record<string, Array<Record<string, string>>> = {}
  const exportsMap: Record<string, string> = {}
  const stepResults: StepResult[] = []
  let blockedBySafeGuard = false
  let safeGuardMessage = ''
  let selectedJumpTo: { label: string; value: string } | undefined
  let hostMatchFailed: ValidationResult | null = null

  const templateDrivesLogin = templateStepsDriveLogin(template?.steps)
  let password = ''
  try {
    password = (await fetchCredentials(profile.id)).password
  } catch (err) {
    stepResults.push({ index: 0, kind: 'fatal', ok: false, error: `credentials: ${(err as Error).message}` })
  }

  try {
    await postProgress(session.id, {
      message: `Starting session "${session.name}" on ${config.packageName}`,
      step: session.template_code || session.name,
      metadata: { worker_id: config.workerId, package: config.packageName },
    }).catch(() => null)

    if (!templateDrivesLogin && password) {
      try {
        const loginResult = await loginToTarget(page, profile, runtime_contract)
        selectedJumpTo = loginResult.selectedJumpTo
          ? { label: loginResult.selectedJumpTo.label, value: loginResult.selectedJumpTo.value }
          : undefined
        await screenshots.take(page, 'after-login')
      } catch (err) {
        const e = err as Error & { ruleCode?: string; situation?: string }
        if (e.ruleCode === 'AUTH_PRODUCT_HOST_MATCH' || /AUTH_PRODUCT_HOST_MATCH|Wrong product host/i.test(e.message)) {
          hostMatchFailed = {
            rule_code: 'AUTH_PRODUCT_HOST_MATCH',
            passed: false,
            severity: 'critical',
            notes: e.message,
            actual: page.url(),
            expected: profile.base_url,
          }
          await screenshots.take(page, 'wrong-product-host')
          throw err
        }
        if (e.situation === 'login_otp_or_challenge') {
          stepResults.push({ index: 0, kind: 'login_otp_or_challenge', ok: false, error: e.message })
          await screenshots.take(page, 'login-otp-challenge')
          throw err
        }
        throw err
      }

      if (!opts.basicCheck) {
        const company = (data['company'] as { name: string } | undefined)?.name
        if (company) await selectOrCreateCompany(page, company)

        const branch = (data['branch'] as { name: string } | undefined)?.name
        if (branch) await selectOrCreateBranch(page, branch)

        const fy = data['financial_year'] as { name: string; start: string; end: string } | undefined
        if (fy) await selectOrCreateFinancialYear(page, fy)
      }
      await screenshots.take(page, 'after-context')
    }

    const rawSteps = pickStepsForEnv(template, profile.environment)
    const steps = rawSteps.length
      ? interpolate(rawSteps, session.qa_run_id, {
        login_url: profile.login_url,
        base_url: profile.base_url,
        username: profile.username,
        password,
        jump_to: runtime_contract?.login?.jump_to_candidates?.[0] || profile.product_name,
        allowed_domains: Array.isArray(profile.allowed_domains)
          ? profile.allowed_domains.join(',')
          : '',
        fy_start: (data['financial_year'] as { start: string } | undefined)?.start ?? '',
        fy_end: (data['financial_year'] as { end: string } | undefined)?.end ?? '',
      })
      : []

    let stepIdx = 0
    const stepList = steps as TemplateStep[]
    const totalSteps = stepList.length
    for (const stRaw of stepList) {
      const st = hydrateItems(stRaw as unknown as Record<string, unknown>, data) as TemplateStep
      try {
        await postProgress(session.id, {
          message: `Step ${stepIdx + 1}/${totalSteps}: ${String(st.kind)}`,
          step: String(st.kind),
          step_index: stepIdx + 1,
          total_steps: totalSteps,
        }).catch(() => null)

        const r = await runStep(st, ++stepIdx, {
          page,
          guard,
          tables,
          qaRunId: session.qa_run_id,
          session,
          run,
          profile,
          runtimeContract: runtime_contract,
          sessionDir: dir,
          exports: exportsMap,
          selectedJumpTo,
        })
        if (r.data && typeof r.data === 'object' && 'selected_jump_to' in (r.data as object)) {
          /* keep */
        }
        if (st.kind === 'select' && r.detail?.includes('=')) {
          const label = r.detail.split('=').slice(1).join('=')
          selectedJumpTo = selectedJumpTo || { label, value: label }
        }
        stepResults.push(r)

        if (r.data && typeof r.data === 'object' && (r.data as { rule_code?: string }).rule_code === 'AUTH_PRODUCT_HOST_MATCH') {
          hostMatchFailed = {
            rule_code: 'AUTH_PRODUCT_HOST_MATCH',
            passed: false,
            severity: 'critical',
            notes: r.error,
            actual: String((r.data as { actual_host?: string }).actual_host || page.url()),
            expected: String((r.data as { expected_host?: string }).expected_host || profile.base_url),
          }
          await screenshots.take(page, 'wrong-product-host')
          break
        }

        if (!r.ok) {
          await screenshots.take(page, `step-${stepIdx}-failed`)
          if (st.kind === 'expect_login_outcome' || st.kind === 'expect_product_host') break
        }
        if (r.abortSession) break
        if (r.skipRemaining) {
          stepResults.push({ index: stepIdx, kind: 'skipped_remaining', ok: true, detail: 'operator skipped remaining file I/O' })
          break
        }
      } catch (err) {
        if (err instanceof SafeActionBlocked) {
          blockedBySafeGuard = true
          safeGuardMessage = err.message
          stepResults.push({ index: stepIdx, kind: String(st.kind), ok: false, error: err.message })
          await screenshots.take(page, `step-${stepIdx}-safeguard-blocked`)
          break
        }
        stepResults.push({ index: stepIdx, kind: String(st.kind), ok: false, error: (err as Error)?.message ?? String(err) })
        await screenshots.take(page, `step-${stepIdx}-error`)
        break
      }
    }
    await screenshots.take(page, 'final-state')
  } catch (err) {
    stepResults.push({ index: 0, kind: 'fatal', ok: false, error: (err as Error)?.message ?? String(err) })
    await screenshots.take(page, 'fatal').catch(() => null)
  } finally {
    clearInterval(heart)
  }

  const tracePath = await trace.stop(ctx).catch(() => null)
  await ctx.close().catch(() => null)
  await browser.close().catch(() => null)

  const acc = runAccountingChecks({ tables, expected, rules })
  const rep = runReportChecks({ tables, expected, rules })
  const ui = runUiChecks({
    console: consoleCap.all(),
    network: netCap.errors(),
    steps: stepResults,
    rules,
  })

  let validations: ValidationResult[] = [...acc, ...rep, ...ui]
  if (hostMatchFailed) validations = [hostMatchFailed, ...validations]
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

  const failedSteps = stepResults.filter((s) => !s.ok)
  const fatalStep = failedSteps.find((s) => s.kind === 'fatal')

  const body: SessionPostBody = {
    status: blockedBySafeGuard ? 'skipped' : report.status,
    severity: report.severity,
    passed_count: report.passed,
    failed_count: report.failed,
    warning_count: report.warnings,
    result_json: {
      worker: config.packageName,
      worker_id: config.workerId,
      tested_screens: Array.from(new Set(stepResults.filter((s) => s.kind === 'navigate_menu').map((s) => s.detail).filter(Boolean))),
      data_entered_keys: template?.data_keys ?? [],
      workflow_steps: stepResults.length,
      tables_read: Object.keys(tables),
      blocked_by_safe_guard: blockedBySafeGuard,
      selected_jump_to: selectedJumpTo ?? null,
      fatal_error: fatalStep?.error ?? failedSteps[0]?.error ?? null,
      failed_steps: failedSteps.slice(0, 12).map((s) => ({
        kind: s.kind,
        error: s.error ?? null,
        index: s.index,
        data: s.data ?? null,
      })),
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

  try {
    await postResult(session.id, body)
    for (const p of screenshots.paths()) {
      await uploadEvidence(session.id, p, 'screenshot').catch(() => null)
    }
    if (tracePath) await uploadEvidence(session.id, tracePath, 'trace').catch(() => null)
    await uploadEvidence(session.id, report.htmlPath, 'html').catch(() => null)
    await uploadEvidence(session.id, report.jsonPath, 'json').catch(() => null)
  } catch (err) {
    console.error(`[${config.packageName}] postResult failed:`, (err as Error)?.message)
  }

  return true
}

function templateStepsDriveLogin(steps?: TemplateStep[] | null): boolean {
  if (!steps?.length) return false
  return steps.some((s) =>
    s.kind === 'expect_login_outcome'
    || s.kind === 'expect_product_host'
    || (s.kind === 'navigate' && /login/i.test(String(s.to || ''))),
  )
}

function pickStepsForEnv(
  template: NextSessionPayload['template'],
  environment: string,
): TemplateStep[] {
  if (!template) return []
  const byEnv = template.steps_by_env?.[environment]
  if (Array.isArray(byEnv) && byEnv.length) return byEnv
  return template.steps || []
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
