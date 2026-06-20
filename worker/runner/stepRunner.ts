import type { Page } from 'playwright'
import type { TemplateStep } from '../types.js'
import { guardedClick, isBlocked, SafeActionBlocked, type GuardContext } from '../utils/safeActionGuard.js'

export interface StepResult {
  index: number
  kind: string
  ok: boolean
  detail?: string
  error?: string
  data?: unknown
}

export interface StepRunnerContext {
  page: Page
  guard: GuardContext
  tables: Record<string, Array<Record<string, string>>>
  qaRunId: string
}

/**
 * Executes a single template step. Selector-fallback-friendly: when a step
 * provides selector_options[], the runner tries each until one matches.
 *
 * Supported kinds:
 *  - navigate            { to }
 *  - navigate_menu       { path: ['Masters','Ledger'] }
 *  - fill                { selector|selector_options, value }
 *  - select              { selector|selector_options, value }
 *  - click               { selector|selector_options }
 *  - search              { selector|selector_options, value }
 *  - read_table          { selector|selector_options, key }
 *  - expect_visible      { selector|selector_options }
 *  - expect_url          { matches }
 *  - expect_toast        { matches }
 *  - expect_text         { matches }
 *  - expect_row          { table_key, match_text }
 *  - expect_metric       { metric_key, from, row_match? }   (only records, comparison done by validators)
 *  - apply_date_filter   { from, to }
 *  - keyboard_flow       { sequence: ['Tab','Tab','Type:foo','Enter'] }
 *  - select_or_create_company / branch / financial_year — handled by the session runner before stepRunner.
 *  - ensure_master_exists{ kind_label, items, name_field }
 *  - create_voucher      { kind_label, items, with_items, schema, service_ledger }
 *  - select_ledger       { name }
 *  - scan_theme          { ... }
 */
export async function runStep(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const kind = String(step.kind || '')
  try {
    switch (kind) {
      case 'navigate':         return await navigate(step, idx, ctx)
      case 'navigate_menu':    return await navigateMenu(step, idx, ctx)
      case 'fill':             return await fillStep(step, idx, ctx)
      case 'select':           return await selectStep(step, idx, ctx)
      case 'click':            return await clickStep(step, idx, ctx)
      case 'search':           return await searchStep(step, idx, ctx)
      case 'read_table':       return await readTable(step, idx, ctx)
      case 'expect_visible':   return await expectVisible(step, idx, ctx)
      case 'expect_url':       return await expectUrl(step, idx, ctx)
      case 'expect_toast':     return await expectToast(step, idx, ctx)
      case 'expect_text':      return await expectText(step, idx, ctx)
      case 'expect_row':       return expectRow(step, idx, ctx)
      case 'expect_metric':    return expectMetric(step, idx, ctx)
      case 'apply_date_filter':return await applyDateFilter(step, idx, ctx)
      case 'keyboard_flow':    return await keyboardFlow(step, idx, ctx)
      case 'ensure_master_exists': return await ensureMasterExists(step, idx, ctx)
      case 'create_voucher':   return await createVoucher(step, idx, ctx)
      case 'select_ledger':    return await selectLedger(step, idx, ctx)
      case 'scan_theme':       return await scanTheme(step, idx, ctx)
      default:
        return { index: idx, kind, ok: true, detail: `step kind "${kind}" not yet handled — recorded as no-op` }
    }
  } catch (err) {
    if (err instanceof SafeActionBlocked) {
      throw err
    }
    return { index: idx, kind, ok: false, error: (err as Error)?.message ?? String(err) }
  }
}

function selectorList(step: TemplateStep): string[] {
  const single = typeof step.selector === 'string' ? [step.selector as string] : []
  const many   = Array.isArray(step.selector_options) ? (step.selector_options as string[]) : []
  return [...single, ...many].filter(Boolean)
}

async function findOne(ctx: StepRunnerContext, step: TemplateStep): Promise<{ sel: string } | null> {
  for (const sel of selectorList(step)) {
    const l = ctx.page.locator(sel).first()
    try {
      if (await l.count()) return { sel }
    } catch { /* ignore broken selector */ }
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
  await ctx.page.locator(hit.sel).first().selectOption({ label: String(step.value) }).catch(async () => {
    await ctx.page.locator(hit.sel).first().fill(String(step.value))
  })
  return { index: idx, kind: 'select', ok: true, detail: hit.sel }
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
    trs.map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c as HTMLElement).innerText.trim()))
  )
  // Convert to map-per-row using first row as header.
  const [header, ...body] = rows
  const data = header
    ? body.map((row) => Object.fromEntries(row.map((v, i) => [header[i] || String(i), v])))
    : []
  ctx.tables[String(step.key)] = data
  return { index: idx, kind: 'read_table', ok: true, data: { rows: data.length, key: step.key } }
}

async function expectVisible(step: TemplateStep, idx: number, ctx: StepRunnerContext): Promise<StepResult> {
  const hit = await findOne(ctx, step)
  if (!hit) return { index: idx, kind: 'expect_visible', ok: false, error: 'no matching element' }
  await ctx.page.locator(hit.sel).first().waitFor({ state: 'visible', timeout: 30_000 })
  return { index: idx, kind: 'expect_visible', ok: true, detail: hit.sel }
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
  // Validation engine in worker compares this; here we just record.
  return { index: idx, kind: 'expect_metric', ok: true, detail: `${key}=${actual ?? 'unread'}` , data: { metric_key: key, actual } }
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
    if (k.startsWith('Type:')) {
      await ctx.page.keyboard.type(k.slice(5))
    } else {
      await ctx.page.keyboard.press(k)
    }
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
  // Best-effort generic voucher entry. Real templates can override by supplying explicit fill/click steps.
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
  return { index: idx, kind: 'create_voucher', ok: created > 0, detail: `${created} vouchers created` }
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
  const brand = String(step.expected_brand_colour_hex || '#16a34a').toLowerCase()
  const legacy = (step.detect_legacy_classes as string[]) || []
  const observed = await ctx.page.evaluate(({ legacy }) => {
    const root = document.body
    const styles = window.getComputedStyle(root)
    const used = Array.from(document.querySelectorAll('[class]')).map((el) => (el as HTMLElement).className).join(' ')
    const legacyHits = legacy.filter((k: string) => new RegExp(`\\b${k}`, 'i').test(used))
    return {
      bg: styles.backgroundColor,
      color: styles.color,
      legacyHits,
    }
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
