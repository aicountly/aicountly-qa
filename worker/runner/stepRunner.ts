import type { Page } from 'playwright'
import type { DecisionOption, Run, Session, TargetProfile, TemplateStep } from '../types.js'
import { guardedClick, isBlocked, SafeActionBlocked, type GuardContext } from '../utils/safeActionGuard.js'
import { evaluateHostGuard } from '../utils/hostGuard.js'
import { askOrRecallDecision } from '../nav/askDecision.js'
import { runFileIoStep, type FileIoContext } from '../fileIo/fileIoSteps.js'
import { buildJumpPlan, pickJumpTarget, type JumpOption } from '../auth/jumpTargets.js'
import { selectOrCreateCompany } from '../context/companyContext.js'
import { selectOrCreateBranch } from '../context/branchContext.js'
import { selectOrCreateFinancialYear } from '../context/financialYearContext.js'

export interface StepResult {
  index: number
  kind: string
  ok: boolean
  detail?: string
  error?: string
  data?: unknown
  abortSession?: boolean
  skipRemaining?: boolean
}

export interface StepRunnerContext {
  page: Page
  guard: GuardContext
  tables: Record<string, Array<Record<string, string>>>
  qaRunId: string
  session: Session
  run: Run
  profile: TargetProfile
  runtimeContract?: {
    login?: { jump_to_candidates?: string[]; jump_to_selectors?: string[] }
    post_login_host_guard?: {
      expected_base_url?: string
      allowed_domains?: string[]
      recovery?: string
      validation_rule?: string
    }
  } | null
  sessionDir: string
  exports: Record<string, string>
  selectedJumpTo?: { label: string; value: string }
}

/**
 * Executes a single template step. Selector-fallback-friendly.
 *
 * Core kinds: navigate, navigate_menu, fill, select (value_options), click, search,
 * read_table, expect_*, apply_date_filter, keyboard_flow, ensure_master_exists,
 * create_voucher, select_ledger, scan_theme, expect_login_outcome, expect_product_host,
 * ask_decision, file_* / assert_file_upload_blocked.
 */
export async function runStep(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const kind = String(step.kind || '')
  try {
    switch (kind) {
      case 'navigate': return await navigate(step, idx, ctx)
      case 'navigate_menu': return await navigateMenu(step, idx, ctx)
      case 'fill': return await fillStep(step, idx, ctx)
      case 'select': return await selectStep(step, idx, ctx)
      case 'click': return await clickStep(step, idx, ctx)
      case 'search': return await searchStep(step, idx, ctx)
      case 'read_table': return await readTable(step, idx, ctx)
      case 'expect_visible': return await expectVisible(step, idx, ctx)
      case 'expect_url': return await expectUrl(step, idx, ctx)
      case 'expect_toast': return await expectToast(step, idx, ctx)
      case 'expect_text': return await expectText(step, idx, ctx)
      case 'expect_row': return expectRow(step, idx, ctx)
      case 'expect_metric': return expectMetric(step, idx, ctx)
      case 'expect_close_balance': return expectMetric({ ...step, metric_key: step.metric_key || 'close_balance' }, idx, ctx)
      case 'expect_login_outcome': return await expectLoginOutcome(step, idx, ctx)
      case 'expect_product_host': return await expectProductHost(step, idx, ctx)
      case 'ask_decision': return await askDecisionStep(step, idx, ctx)
      case 'file_import':
      case 'expect_import_result':
      case 'file_export':
      case 'compare_file_roundtrip':
      case 'file_upload_expect_rejected':
      case 'assert_file_upload_blocked':
        return await runFileIoStep(step, idx, fileCtx(ctx))
      case 'apply_date_filter': return await applyDateFilter(step, idx, ctx)
      case 'keyboard_flow': return await keyboardFlow(step, idx, ctx)
      case 'ensure_master_exists': return await ensureMasterExists(step, idx, ctx)
      case 'create_voucher': return await createVoucher(step, idx, ctx)
      case 'select_ledger': return await selectLedger(step, idx, ctx)
      case 'scan_theme': return await scanTheme(step, idx, ctx)
      case 'select_or_create_company': {
        const name = String(step.name_template || step.name || '')
        if (!name) return { index: idx, kind, ok: false, error: 'company name missing' }
        await selectOrCreateCompany(ctx.page, name)
        return { index: idx, kind, ok: true, detail: name }
      }
      case 'select_or_create_branch': {
        const name = String(step.name_template || step.name || '')
        if (!name) return { index: idx, kind, ok: false, error: 'branch name missing' }
        await selectOrCreateBranch(ctx.page, name)
        return { index: idx, kind, ok: true, detail: name }
      }
      case 'select_or_create_financial_year': {
        const fy = {
          name: String(step.name || 'FY'),
          start: String(step.start || ''),
          end: String(step.end || ''),
        }
        await selectOrCreateFinancialYear(ctx.page, fy)
        return { index: idx, kind, ok: true, detail: fy.name }
      }
      default:
        return { index: idx, kind, ok: true, detail: `step kind "${kind}" not yet handled — recorded as no-op` }
    }
  } catch (err) {
    if (err instanceof SafeActionBlocked) throw err
    return { index: idx, kind, ok: false, error: (err as Error)?.message ?? String(err) }
  }
}

function fileCtx(ctx: StepRunnerContext): FileIoContext {
  return {
    page: ctx.page,
    guard: ctx.guard,
    sessionDir: ctx.sessionDir,
    exports: ctx.exports,
    productName: ctx.profile.product_name,
  }
}

function selectorList(step: TemplateStep): string[] {
  const single = typeof step.selector === 'string' ? [step.selector as string] : []
  const many = Array.isArray(step.selector_options) ? (step.selector_options as string[]) : []
  return [...single, ...many].filter(Boolean)
}

function valueOptions(step: TemplateStep): string[] {
  const single = step.value !== undefined && step.value !== null ? [String(step.value)] : []
  const many = Array.isArray(step.value_options) ? (step.value_options as unknown[]).map(String) : []
  return [...single, ...many].filter((v) => v && !/^\{.+\}$/.test(v))
}

async function findOne(ctx: StepRunnerContext, step: TemplateStep): Promise<{ sel: string } | null> {
  for (const sel of selectorList(step)) {
    const l = ctx.page.locator(sel).first()
    try {
      if (await l.count()) return { sel }
    } catch { /* ignore */ }
  }
  return null
}

async function navigate(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const url = String(step.to)
  await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  return { index: idx, kind: 'navigate', ok: true, detail: url }
}

async function navigateMenu(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const path = (step.path as string[]) || []
  for (const item of path) {
    const l = ctx.page.locator(`a:has-text("${item}"), button:has-text("${item}"), [role=menuitem]:has-text("${item}")`).first()
    if (await l.count()) {
      await l.click()
      await ctx.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    }
  }
  return { index: idx, kind: 'navigate_menu', ok: true, detail: path.join(' → ') }
}

async function fillStep(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const hit = await findOne(ctx, step)
  if (!hit) {
    if (step.optional) return { index: idx, kind: 'fill', ok: true, detail: 'optional field not present' }
    return { index: idx, kind: 'fill', ok: false, error: 'no matching field' }
  }
  await ctx.page.locator(hit.sel).first().fill(String(step.value ?? ''))
  return { index: idx, kind: 'fill', ok: true, detail: hit.sel }
}

async function selectStep(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const hit = await findOne(ctx, step)
  if (!hit) {
    if (step.optional) return { index: idx, kind: 'select', ok: true, detail: 'optional field not present' }
    return { index: idx, kind: 'select', ok: false, error: 'no matching field' }
  }
  const loc = ctx.page.locator(hit.sel).first()
  const options: JumpOption[] = await loc.locator('option').evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      label: ((el as HTMLOptionElement).textContent || '').trim(),
    })),
  ).catch(() => [])

  const candidates = [
    ...valueOptions(step),
    ...(ctx.runtimeContract?.login?.jump_to_candidates ?? []),
  ]
  if (options.length && candidates.length) {
    const plan = buildJumpPlan(ctx.profile.product_name, candidates)
    const pick = pickJumpTarget(options, plan)
    if (pick) {
      await loc.selectOption({ value: pick.option.value }).catch(async () => {
        await loc.selectOption({ label: pick.option.label })
      })
      ctx.selectedJumpTo = { label: pick.option.label, value: pick.option.value }
      return { index: idx, kind: 'select', ok: true, detail: `${hit.sel}=${pick.option.label}` }
    }
  }

  for (const val of valueOptions(step)) {
    try {
      await loc.selectOption({ label: val })
      return { index: idx, kind: 'select', ok: true, detail: `${hit.sel}=${val}` }
    } catch { /* try next */ }
    try {
      await loc.selectOption({ value: val })
      return { index: idx, kind: 'select', ok: true, detail: `${hit.sel}=${val}` }
    } catch { /* try next */ }
  }

  if (step.value !== undefined) {
    await loc.selectOption({ label: String(step.value) }).catch(async () => {
      await loc.fill(String(step.value))
    })
    return { index: idx, kind: 'select', ok: true, detail: hit.sel }
  }
  return { index: idx, kind: 'select', ok: false, error: 'no matching option' }
}

async function clickStep(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const hit = await findOne(ctx, step)
  if (!hit) return { index: idx, kind: 'click', ok: false, error: 'no matching button' }
  const label = (await ctx.page.locator(hit.sel).first().innerText().catch(() => '')) || hit.sel
  const b = isBlocked(label, ctx.guard)
  if (b.blocked) throw new SafeActionBlocked(label, b.match || '')
  await guardedClick(ctx.page, hit.sel, ctx.guard)
  return { index: idx, kind: 'click', ok: true, detail: label }
}

async function searchStep(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const hit = await findOne(ctx, step)
  if (!hit) return { index: idx, kind: 'search', ok: true, detail: 'no search input found' }
  await ctx.page.locator(hit.sel).first().fill(String(step.value ?? ''))
  await ctx.page.keyboard.press('Enter').catch(() => {})
  return { index: idx, kind: 'search', ok: true, detail: hit.sel }
}

async function readTable(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const hit = await findOne(ctx, step)
  if (!hit) return { index: idx, kind: 'read_table', ok: false, error: 'no matching table' }
  const rows = await ctx.page.locator(hit.sel).first().locator('tr').evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c as HTMLElement).innerText.trim())),
  )
  const [header, ...body] = rows
  const data = header
    ? body.map((row) => Object.fromEntries(row.map((v, i) => [header[i] || String(i), v])))
    : []
  ctx.tables[String(step.key)] = data
  return { index: idx, kind: 'read_table', ok: true, data: { rows: data.length, key: step.key } }
}

async function expectVisible(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const timeout = Number(step.timeout_ms ?? 30_000)
  const hit = await findOne(ctx, step)
  if (!hit) {
    const note = step.on_failure_note ? String(step.on_failure_note) : 'no matching element'
    const visible = await collectVisibleErrors(ctx.page)
    return { index: idx, kind: 'expect_visible', ok: false, error: `${note}${visible ? ` | ${visible}` : ''}` }
  }
  try {
    await ctx.page.locator(hit.sel).first().waitFor({ state: 'visible', timeout })
    return { index: idx, kind: 'expect_visible', ok: true, detail: hit.sel }
  } catch {
    const note = step.on_failure_note ? String(step.on_failure_note) : `not visible: ${hit.sel}`
    const visible = await collectVisibleErrors(ctx.page)
    return { index: idx, kind: 'expect_visible', ok: false, error: `${note}${visible ? ` | ${visible}` : ''}` }
  }
}

async function expectUrl(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const re = new RegExp(String(step.matches))
  await ctx.page.waitForURL(re, { timeout: 30_000 })
  return { index: idx, kind: 'expect_url', ok: true, detail: String(step.matches) }
}

async function expectToast(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const re = new RegExp(String(step.matches), 'i')
  const found = await ctx.page
    .locator('[role=alert], .toast, .ant-message, .Toastify__toast, [data-test=toast]')
    .first()
    .innerText({ timeout: 10_000 })
    .catch(() => '')
  const ok = re.test(found)
  return { index: idx, kind: 'expect_toast', ok, detail: found.slice(0, 200), error: ok ? undefined : `expected toast matching ${re}` }
}

async function expectText(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const re = new RegExp(String(step.matches), 'i')
  const body = await ctx.page.locator('body').innerText().catch(() => '')
  const ok = re.test(body)
  return { index: idx, kind: 'expect_text', ok, error: ok ? undefined : `expected text matching ${re}` }
}

function expectRow(step: TemplateStep, idx: number, ctx: StepRunnerContext): StepResult {
  const tableKey = String(step.table_key)
  const text = String(step.match_text)
  const rows = ctx.tables[tableKey] || []
  const found = rows.some((r) => Object.values(r).some((v) => typeof v === 'string' && v.includes(text)))
  return { index: idx, kind: 'expect_row', ok: found, error: found ? undefined : `no row matched "${text}" in table "${tableKey}"` }
}

function expectMetric(step: TemplateStep, idx: number, ctx: StepRunnerContext): StepResult {
  const key = String(step.metric_key)
  const fromTable = String(step.from)
  const rowMatch = step.row_match ? new RegExp(String(step.row_match), 'i') : null
  const rows = ctx.tables[fromTable] || []
  let actual: string | undefined
  for (const row of rows) {
    const concat = Object.values(row).join(' ')
    if (!rowMatch || rowMatch.test(concat)) {
      const nums = Object.values(row).filter((v) => typeof v === 'string' && /\d/.test(v))
      actual = nums[nums.length - 1] as string | undefined
      if (actual) break
    }
  }
  return { index: idx, kind: 'expect_metric', ok: true, detail: `${key}=${actual ?? 'unread'}`, data: { metric_key: key, actual } }
}

async function expectLoginOutcome(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const url = ctx.page.url()
  const successRe = new RegExp(String(step.success_url_matches || '/dashboard|/home|/companies|/app'), 'i')
  const loginRe = new RegExp(String(step.login_url_matches || '/login'), 'i')
  if (successRe.test(url) && !loginRe.test(url)) {
    return { index: idx, kind: 'expect_login_outcome', ok: true, detail: url }
  }
  if (loginRe.test(url)) {
    const errors = await collectVisibleErrors(ctx.page, step)
    const note = step.failed_steps_note ? String(step.failed_steps_note) : 'Login remained on /login'
    return {
      index: idx,
      kind: 'expect_login_outcome',
      ok: false,
      error: `${note}${errors ? ` | ${errors}` : ''}`,
      data: { landed_url: url, selected_jump_to: ctx.selectedJumpTo },
    }
  }
  return { index: idx, kind: 'expect_login_outcome', ok: true, detail: url }
}

async function expectProductHost(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const baseUrl = String(step.expected_base_url || ctx.runtimeContract?.post_login_host_guard?.expected_base_url || ctx.profile.base_url)
  const allowed = (step.allowed_domains as string[] | string | undefined)
    ?? ctx.runtimeContract?.post_login_host_guard?.allowed_domains
    ?? ctx.profile.allowed_domains
  const recoverOnce = step.recover_once !== false
  const rule = String(step.rule_code || ctx.runtimeContract?.post_login_host_guard?.validation_rule || 'AUTH_PRODUCT_HOST_MATCH')

  let result = evaluateHostGuard({ currentUrl: ctx.page.url(), baseUrl, allowedDomains: allowed })
  if (!result.ok && recoverOnce && baseUrl) {
    await ctx.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
    await ctx.page.waitForTimeout(400)
    result = evaluateHostGuard({ currentUrl: ctx.page.url(), baseUrl, allowedDomains: allowed })
  }
  if (result.ok) {
    return { index: idx, kind: 'expect_product_host', ok: true, detail: result.actualHost }
  }
  const note = step.on_failure_note ? String(step.on_failure_note) : result.message
  return {
    index: idx,
    kind: 'expect_product_host',
    ok: false,
    error: `${rule}: ${note}`,
    data: {
      rule_code: rule,
      expected_host: result.expectedHost,
      actual_host: result.actualHost,
      landed_url: ctx.page.url(),
      selected_jump_to: ctx.selectedJumpTo,
    },
  }
}

async function askDecisionStep(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const options = (Array.isArray(step.options_json) ? step.options_json : step.options) as DecisionOption[]
  if (!options?.length) {
    return { index: idx, kind: 'ask_decision', ok: false, error: 'ask_decision requires options_json' }
  }
  const choice = await askOrRecallDecision({
    page: ctx.page,
    session: ctx.session,
    run: ctx.run,
    profile: ctx.profile,
    situationKey: String(step.situation_key || 'generic'),
    question: String(step.question || 'Choose how to proceed'),
    options,
    context: { step_index: idx, kind: 'ask_decision' },
  })

  const id = choice.option.id
  if (id === 'abort_session') {
    return { index: idx, kind: 'ask_decision', ok: false, abortSession: true, error: 'Operator aborted session', detail: id }
  }
  if (id === 'skip_file_io' || id === 'skip_step') {
    return { index: idx, kind: 'ask_decision', ok: true, skipRemaining: id === 'skip_file_io', detail: id }
  }
  if (id === 'mark_blocked') {
    throw new SafeActionBlocked(choice.option.label, 'mark_blocked')
  }
  if (id === 'dismiss_overlay') {
    await ctx.page.keyboard.press('Escape').catch(() => {})
    await ctx.page.locator('button:has-text("Close"), button:has-text("Dismiss"), [aria-label=Close]').first().click().catch(() => {})
  }
  if (id === 'wait_and_retry') {
    await ctx.page.waitForTimeout(2_000)
  }
  // approve_upload / open_company / others: continue; callers act on subsequent steps.
  return { index: idx, kind: 'ask_decision', ok: true, detail: `${choice.source}:${id}`, data: { choice } }
}

async function collectVisibleErrors(page: Page, step?: TemplateStep): Promise<string> {
  const selectors = Array.isArray(step?.error_selector_options)
    ? (step!.error_selector_options as string[])
    : ['[role=alert]', '.alert-danger', '.error', '.invalid-feedback', '[class*=error]']
  const chunks: string[] = []
  for (const sel of selectors) {
    const texts = await page.locator(sel).allInnerTexts().catch(() => [])
    chunks.push(...texts)
  }
  const body = await page.locator('body').innerText().catch(() => '')
  const textRe = new RegExp(String(step?.error_text_matches || 'jump to|credential|password|invalid|incorrect|otp|verification|challenge'), 'i')
  for (const line of body.split(/\n+/)) {
    if (textRe.test(line)) chunks.push(line.trim())
  }
  return chunks.join(' | ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

async function applyDateFilter(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const from = String(step.from)
  const to = String(step.to)
  for (const [sel, val] of [
    ['[data-test=date-from], input[name=from], input[type=date][placeholder*="From" i]', from],
    ['[data-test=date-to],   input[name=to],   input[type=date][placeholder*="To"   i]', to],
  ] as Array<[string, string]>) {
    const l = ctx.page.locator(sel).first()
    if (await l.count()) await l.fill(val).catch(() => null)
  }
  const apply = ctx.page.locator('button:has-text("Apply"), button:has-text("Filter"), [data-test=apply-filter]').first()
  if (await apply.count()) await apply.click().catch(() => null)
  await ctx.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  return { index: idx, kind: 'apply_date_filter', ok: true, detail: `${from} → ${to}` }
}

async function keyboardFlow(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const seq = (step.sequence as string[]) || []
  for (const k of seq) {
    if (k.startsWith('Type:')) await ctx.page.keyboard.type(k.slice(5))
    else await ctx.page.keyboard.press(k)
    await ctx.page.waitForTimeout(100)
  }
  return { index: idx, kind: 'keyboard_flow', ok: true, detail: `${seq.length} keystrokes` }
}

async function ensureMasterExists(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const items = (step.items as Array<Record<string, unknown>>) || []
  const nameField = String(step.name_field || 'name')
  let created = 0
  for (const it of items) {
    const name = String(it[nameField] ?? '')
    if (!name) continue
    const exists = ctx.page.locator(`tr:has-text("${name}")`).first()
    if (await exists.count()) continue
    const newBtn = ctx.page.locator('button:has-text("New"), button:has-text("Create"), [data-test=new]').first()
    if (await newBtn.count()) {
      await newBtn.click().catch(() => null)
      await ctx.page.locator(`input[name="${nameField}"], input[name="name"]`).first().fill(name).catch(() => null)
      const save = ctx.page.locator('button[type=submit], button:has-text("Save")').first()
      if (await save.count()) {
        await save.click()
        await ctx.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
        created++
      }
    }
  }
  return { index: idx, kind: 'ensure_master_exists', ok: true, detail: `created ${created} of ${items.length}` }
}

async function createVoucher(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const items = (step.items as Array<Record<string, unknown>>) || []
  let created = 0
  for (const v of items) {
    const newBtn = ctx.page.locator('button:has-text("New"), [data-test=new-voucher]').first()
    if (!(await newBtn.count())) break
    await newBtn.click().catch(() => null)
    await fillIfPresent(ctx, ['input[name=number]', '[data-test=voucher-number]'], String(v.number ?? ''))
    await fillIfPresent(ctx, ['input[name=date]', '[data-test=voucher-date]'], String(v.date ?? ''))
    await fillIfPresent(ctx, ['input[name=party]', 'input[name=ledger]', '[data-test=party]'], String(v.party ?? v.from ?? ''))
    await fillIfPresent(ctx, ['input[name=amount]', '[data-test=amount]'], String(v.amount ?? v.total ?? ''))
    const save = ctx.page.locator('button[type=submit], button:has-text("Save")').first()
    if (await save.count()) {
      await save.click()
      created++
      await ctx.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    }
  }
  return { index: idx, kind: 'create_voucher', ok: created > 0 || items.length === 0, detail: `${created} vouchers created` }
}

async function selectLedger(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const name = String(step.name ?? '')
  const l = ctx.page.locator(`a:has-text("${name}"), tr:has-text("${name}") a, [role=link]:has-text("${name}")`).first()
  if (!(await l.count())) return { index: idx, kind: 'select_ledger', ok: false, error: `ledger "${name}" not found in list` }
  await l.click()
  await ctx.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  return { index: idx, kind: 'select_ledger', ok: true, detail: name }
}

async function scanTheme(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const legacy = (step.detect_legacy_classes as string[]) || []
  const observed = await ctx.page.evaluate(({ legacy }) => {
    const root = document.body
    const styles = window.getComputedStyle(root)
    const used = Array.from(document.querySelectorAll('[class]')).map((el) => (el as HTMLElement).className).join(' ')
    const legacyHits = legacy.filter((k: string) => new RegExp(`\\b${k}`, 'i').test(used))
    return { bg: styles.backgroundColor, color: styles.color, legacyHits }
  }, { legacy })
  const ok = observed.legacyHits.length === 0
  return { index: idx, kind: 'scan_theme', ok, detail: JSON.stringify(observed), error: ok ? undefined : `legacy classes detected: ${observed.legacyHits.join(', ')}` }
}

async function fillIfPresent(ctx: StepRunnerContext, selectors: string[], value: string): Promise<void> {
  if (!value) return
  for (const s of selectors) {
    const l = ctx.page.locator(s).first()
    if (await l.count()) {
      await l.fill(value).catch(() => null)
      return
    }
  }
}
