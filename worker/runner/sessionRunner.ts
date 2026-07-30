/**
 * Orchestrates one QA session end-to-end for the dedicated aicountly-qa-worker.
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

import type { Page } from 'playwright'
import { fetchCredentials, fetchNextSession, heartbeat, postFeatureGaps, postProgress, postResult, uploadEvidence } from '../apiClient.js'
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
import { SafeActionBlocked, type GuardContext } from '../utils/safeActionGuard.js'
import { evaluateHostGuard } from '../utils/hostGuard.js'
import { normalizeEnvironment, templateKeys } from '../utils/environments.js'
import { runFileIoScenarios, shouldRunFileIo } from '../fileIo/fileIoEngine.js'
import { runAgentLoop, type AgentLoopResult } from '../agent/agentLoop.js'
import type { AgentStepRecord } from '../agent/actions.js'
import { runFeatureGapReview } from '../reviewer/competitorComparison.js'
import { toFeatureGapPayload } from '../reviewer/featureGapEngine.js'
import { runDataQualityReview, mergeFindingsIntoPrompts } from '../reviewer/dataQualityBrain.js'
import type {
  ExpectedRow,
  FileIoTestPayload,
  NextSessionPayload,
  Run,
  RuntimeContract,
  Session,
  ValidationResult,
  SessionPostBody,
  Severity,
  TargetProfile,
  TemplateStep,
} from '../types.js'

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

  const guard: GuardContext = {
    environment: normalizeEnvironment(profile.environment),
    productionUnlocked: false,
    allowSafeDemo: profile.allow_safe_demo !== false,
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
  const fileIoTests: FileIoTestPayload[] = []
  const fileIoValidations: ValidationResult[] = []
  let blockedBySafeGuard = false
  let safeGuardMessage = ''
  let selectedJumpTo: { label: string; value: string } | undefined
  let hostMatchFailed: ValidationResult | null = null
  let agentContractUnmet: ValidationResult | null = null
  let agentSteps: AgentStepRecord[] | undefined

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
    const stepList = steps as TemplateStep[]

    const agentMode = resolveAgentMode(payload)
    if (agentMode === 'agent') {
      const agentRun = await runSessionInAgentMode({
        page,
        session,
        run,
        profile,
        guard,
        tables,
        template,
        expected,
        runtimeContract: runtime_contract,
        suggestedPath: stepList,
        screenshotsDir: dir,
        screenshots,
      })
      stepResults.push(agentRun.stepResult)
      agentSteps = agentRun.agentSteps
      if (agentRun.hostMismatch) hostMatchFailed = agentRun.hostMismatch
      if (agentRun.contractUnmet) agentContractUnmet = agentRun.contractUnmet
      if (agentRun.blocked) {
        blockedBySafeGuard = true
        safeGuardMessage = agentRun.blockedReason ?? safeGuardMessage
      }
    } else {
      let stepIdx = 0
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
    }
    if (!blockedBySafeGuard && shouldRunFileIo(session)) {
      await postProgress(session.id, {
        message: 'Running manifest-driven file I/O scenarios',
        step: 'file_io',
      }).catch(() => null)

      const fileIo = await runFileIoScenarios({
        page,
        session,
        run,
        profile,
        guard,
        sessionDir: dir,
        autoApprove: opts.basicCheck,
        scope: {
          urls: [page.url()],
          titles: [await page.title().catch(() => '')],
          labels: [
            session.name,
            String(session.module ?? ''),
            String(session.sub_module ?? ''),
            ...stepResults.map((s) => s.detail ?? ''),
          ].filter(Boolean),
        },
      }).catch((err: Error) => {
        stepResults.push({ index: stepResults.length, kind: 'file_io', ok: false, error: err.message })
        return { tests: [], validations: [] }
      })

      fileIoTests.push(...fileIo.tests)
      fileIoValidations.push(...fileIo.validations)
      for (const test of fileIo.tests) {
        await screenshots.take(page, `file-io-${slug(test.scenario_key)}`).catch(() => null)
      }
    }

    if (config.featureGapEnabled) {
      try {
        const gaps = await runFeatureGapReview({
          page,
          session,
          run,
          profile,
          tables,
          moduleName: session.module ?? undefined,
        })
        if (gaps.length > 0) {
          await postFeatureGaps(session.id, gaps.map(toFeatureGapPayload)).catch((err) => {
            console.warn(`[${config.packageName}] postFeatureGaps failed:`, (err as Error)?.message)
          })
        }
      } catch (err) {
        console.warn(`[${config.packageName}] feature-gap review skipped:`, (err as Error)?.message ?? String(err))
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

  let validations: ValidationResult[] = [...acc, ...rep, ...ui, ...fileIoValidations]
  if (hostMatchFailed) validations = [hostMatchFailed, ...validations]
  if (agentContractUnmet) validations = [agentContractUnmet, ...validations]
  if (blockedBySafeGuard) {
    validations = [
      { rule_code: 'SAFE_ACTION_GUARD', passed: false, severity: 'critical' as Severity, notes: safeGuardMessage },
      ...validations,
    ]
  }

  // Enrichment only — runDataQualityReview() never throws (any brain failure resolves to []).
  const dataQualityFindings = await runDataQualityReview({
    tables,
    expected,
    validations,
    product: profile.product_name,
    environment: String(profile.environment),
    sessionName: session.name,
  })
  validations = mergeFindingsIntoPrompts(validations, dataQualityFindings)

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
      file_io_tests: fileIoTests,
      file_io_summary: summariseFileIo(fileIoTests),
      fatal_error: fatalStep?.error ?? failedSteps[0]?.error ?? null,
      failed_steps: failedSteps.slice(0, 12).map((s) => ({
        kind: s.kind,
        error: s.error ?? null,
        index: s.index,
        data: s.data ?? null,
      })),
      ...(agentSteps ? { agent_steps: agentSteps.map((s) => ({
        ordinal: s.ordinal,
        action: s.action,
        outcome: s.outcome,
        outcome_observation: s.outcome_observation,
        observation: s.observation,
        reasoning: s.reasoning,
        goal_progress: s.goal_progress,
        captured_key: s.captured_key ?? null,
        signature_changed: s.signature_changed,
        provider: s.provider ?? null,
        model: s.model ?? null,
        latency_ms: s.latency_ms ?? null,
      })) } : {}),
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
  // Templates authored before the five-tier rename still key on 'gh'/'prod_basic'.
  for (const key of templateKeys(environment)) {
    const byEnv = template.steps_by_env?.[key]
    if (Array.isArray(byEnv) && byEnv.length) return byEnv
  }
  return template.steps || []
}

/**
 * `brain.agent_mode` lookup. WorkerController::nextSession() reads the
 * `brain.agent_mode` setting and puts it on `runtime_contract.agent_mode`, so
 * that takes priority. The top-level payload is still checked as a secondary
 * hint for forward-compatibility, and QA_AGENT_MODE (default 'template')
 * remains the final fallback for older server builds or local dev without a
 * seeded setting.
 */
function resolveAgentMode(payload: NextSessionPayload): 'agent' | 'template' {
  const contractHint = (payload.runtime_contract as unknown as Record<string, unknown> | null | undefined)?.['agent_mode']
  const payloadHint = (payload as unknown as Record<string, unknown>)['agent_mode']
  const hint = contractHint ?? payloadHint
  if (hint === 'agent' || hint === 'template') return hint
  return config.agentMode === 'agent' ? 'agent' : 'template'
}

/** Rule codes from validations[] plus expected-result metric keys, deduped. */
function buildCaptureContract(template: NextSessionPayload['template'], expected: ExpectedRow[]): string[] {
  const fromValidations = template?.validations ?? []
  const fromExpected = expected.map((row) => row.metric_key)
  return [...new Set([...fromValidations, ...fromExpected])].filter(Boolean)
}

function buildAgentGoal(session: Session, template: NextSessionPayload['template']): string {
  const scope = [session.module, session.sub_module].filter(Boolean).join(' / ') || 'whole application'
  const description = template?.description ? ` ${template.description}` : ''
  return `QA data-quality session "${session.name}". Scope: ${scope}.${description}`.trim()
}

/**
 * Equivalent of stepRunner.ts's expectProductHost() step, run explicitly
 * before the agent loop since agent mode never executes template steps.
 * Duplicated in miniature rather than exported, per the plan's preference
 * for leaving stepRunner.ts's template-mode path untouched.
 */
async function ensureProductHost(
  page: Page,
  profile: TargetProfile,
  runtimeContract?: RuntimeContract | null,
): Promise<ValidationResult | null> {
  const baseUrl = String(runtimeContract?.post_login_host_guard?.expected_base_url || profile.base_url)
  const allowed = runtimeContract?.post_login_host_guard?.allowed_domains ?? profile.allowed_domains
  const rule = String(runtimeContract?.post_login_host_guard?.validation_rule || 'AUTH_PRODUCT_HOST_MATCH')

  let result = evaluateHostGuard({ currentUrl: page.url(), baseUrl, allowedDomains: allowed })
  if (!result.ok && baseUrl) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
    await page.waitForTimeout(400)
    result = evaluateHostGuard({ currentUrl: page.url(), baseUrl, allowedDomains: allowed })
  }
  if (result.ok) return null
  return {
    rule_code: rule,
    passed: false,
    severity: 'critical',
    notes: result.message,
    actual: result.actualHost,
    expected: result.expectedHost,
  }
}

/**
 * Runs the vision agent in place of the template step loop. Maps
 * AgentLoopResult onto the same StepResult/ValidationResult shapes the rest
 * of runOneSession already composes, so downstream validation/report code
 * needs no further changes.
 */
async function runSessionInAgentMode(input: {
  page: Page
  session: Session
  run: Run
  profile: TargetProfile
  guard: GuardContext
  tables: Record<string, Array<Record<string, string>>>
  template: NextSessionPayload['template']
  expected: ExpectedRow[]
  runtimeContract?: RuntimeContract | null
  suggestedPath: TemplateStep[]
  screenshotsDir: string
  screenshots: ScreenshotCapture
}): Promise<{
  stepResult: StepResult
  hostMismatch: ValidationResult | null
  contractUnmet: ValidationResult | null
  blocked: boolean
  blockedReason?: string
  agentSteps?: AgentStepRecord[]
}> {
  const hostMismatch = await ensureProductHost(input.page, input.profile, input.runtimeContract)
  if (hostMismatch) {
    await input.screenshots.take(input.page, 'wrong-product-host').catch(() => null)
    return {
      stepResult: { index: 1, kind: 'agent_loop', ok: false, error: hostMismatch.notes ?? 'wrong product host' },
      hostMismatch,
      contractUnmet: null,
      blocked: false,
    }
  }

  const captureContract = buildCaptureContract(input.template, input.expected)
  const goal = buildAgentGoal(input.session, input.template)

  let result: AgentLoopResult
  try {
    result = await runAgentLoop({
      page: input.page,
      session: input.session,
      run: input.run,
      profile: input.profile,
      guard: input.guard,
      goal,
      budget: config.maxScreensPerSession,
      screenshotsDir: input.screenshotsDir,
      suggestedPath: input.suggestedPath,
      captureContract,
      tables: input.tables,
      onStep: async (step) => {
        await postProgress(input.session.id, {
          message: `Screen ${step.ordinal}: ${step.action.type} -> ${step.outcome}`,
          step: 'agent_step',
          step_index: step.ordinal,
          event_type: 'ai_step',
          metadata: {
            action: step.action,
            outcome: step.outcome,
            outcome_observation: step.outcome_observation,
            observation: step.observation,
            reasoning: step.reasoning,
            goal_progress: step.goal_progress,
            blockers: step.blockers,
            guard: step.guard,
            target_label: step.target_label,
            typed_value: step.typed_value ?? null,
            captured_key: step.captured_key ?? null,
            signature_changed: step.signature_changed,
            provider: step.provider ?? null,
            model: step.model ?? null,
            latency_ms: step.latency_ms ?? null,
            usage: step.usage ?? null,
          },
        }).catch(() => null)
      },
      onLoopWarning: async (message) => {
        await postProgress(input.session.id, { message, step: 'agent_loop_warning' }).catch(() => null)
      },
    })
  } catch (err) {
    await input.screenshots.take(input.page, 'agent-loop-fatal').catch(() => null)
    return {
      stepResult: {
        index: 1,
        kind: 'agent_loop',
        ok: false,
        error: (err as Error)?.message ?? String(err),
      },
      hostMismatch: null,
      contractUnmet: null,
      blocked: false,
    }
  }

  const stepResult: StepResult = {
    index: 1,
    kind: 'agent_loop',
    ok: result.status === 'done',
    detail: `status=${result.status}; screens=${result.screenCount}; reason=${result.reason}`,
    data: { status: result.status, screen_count: result.screenCount, step_count: result.steps.length },
  }

  if (result.status === 'blocked') {
    await input.screenshots.take(input.page, 'agent-loop-blocked').catch(() => null)
    return {
      stepResult,
      hostMismatch: null,
      contractUnmet: null,
      blocked: true,
      blockedReason: result.reason,
      agentSteps: result.steps,
    }
  }

  if (result.status === 'contract_unmet') {
    await input.screenshots.take(input.page, 'agent-loop-contract-unmet').catch(() => null)
    const contractUnmet: ValidationResult = {
      rule_code: 'AI_CAPTURE_CONTRACT',
      passed: false,
      severity: 'high',
      notes: result.reason,
      expected: captureContract.join(', '),
    }
    return { stepResult, hostMismatch: null, contractUnmet, blocked: false, agentSteps: result.steps }
  }

  return { stepResult, hostMismatch: null, contractUnmet: null, blocked: false, agentSteps: result.steps }
}

function summariseFileIo(tests: FileIoTestPayload[]): Record<string, number | null> {
  const counted = tests.filter((t) => t.compare_status === 'pass' || t.compare_status === 'fail')
  const verified = tests.filter((t) => t.data_verified !== null && t.data_verified !== undefined)

  return {
    total: tests.length,
    passed: tests.filter((t) => t.compare_status === 'pass').length,
    failed: tests.filter((t) => t.compare_status === 'fail').length,
    partial: tests.filter((t) => t.compare_status === 'partial').length,
    blocked: tests.filter((t) => t.compare_status === 'blocked').length,
    skipped: tests.filter((t) => t.compare_status === 'skipped').length,
    data_verified: verified.filter((t) => t.data_verified === true).length,
    data_mismatched: verified.filter((t) => t.data_verified === false).length,
    pass_rate: counted.length === 0
      ? null
      : Number(((tests.filter((t) => t.compare_status === 'pass').length / counted.length) * 100).toFixed(1)),
  }
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
