/**
 * Set-of-Marks action vocabulary for the vision agent, ported from
 * aicountly-smoke-app's agent/actions.ts. Two QA-specific bridges:
 *  - guardAction() routes through this repo's isBlocked()/isUnsafeToFill()
 *    instead of smoke's evaluateClick()/allowed_actions_json.
 *  - a new `capture_table` action writes rows into the shared `tables` map
 *    that accountingValidation.ts / reportValidation.ts already read from.
 * smoke's dateFieldProbe integration (a UX-locale finding feature) has no
 * QA equivalent and is intentionally omitted.
 */

import type { Page } from 'playwright'
import type { TargetProfile } from '../types.js'
import { applyMarker } from '../data/qaMarker.js'
import { isUnsafeToFill } from '../forms/unsafeFields.js'
import { evaluateHostGuard } from '../utils/hostGuard.js'
import { isBlocked, type GuardContext } from '../utils/safeActionGuard.js'
import { markInteractive, unmark, type MarkDescriptor } from './marks.js'
import { captureViewportJpeg, signature, waitForSettle, type PageSignature } from './perceive.js'
import { coerceForField } from './valueCoercion.js'

export type AgentAction =
  | { type: 'click'; mark: number }
  | { type: 'type'; mark: number; text: string; submit?: boolean }
  | { type: 'select'; mark: number; option: string }
  | { type: 'press'; key: string }
  | { type: 'scroll'; direction: 'up' | 'down'; amount: number }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; ms: number }
  | { type: 'capture_table'; mark: number; key: string }
  | { type: 'done'; reason: string }
  | { type: 'blocked'; reason: string }
  | { type: 'ask_operator'; question: string; options: string[] }

/** Local equivalent of smoke's utils/safeActionGuard GuardDecision shape. */
export type GuardDecision = {
  allowed: boolean
  reason?: string
  matchedToken?: string
}

export type ActionOutcome = {
  status: 'executed' | 'refused' | 'terminal' | 'failed'
  observation: string
  guard: GuardDecision
  screenshot?: string
  before: PageSignature
  after: PageSignature
  target_label: string
  typed_value?: string
  /** Set when the action was `capture_table` and it wrote into `tables`. */
  captured_key?: string
}

export type AgentStepRecord = {
  ordinal: number
  captured_at: string
  screenshot: string
  observation: string
  reasoning: string
  goal_progress: string
  blockers: string[]
  action: AgentAction
  outcome: ActionOutcome['status']
  outcome_observation: string
  guard: GuardDecision
  target_label: string
  typed_value?: string
  captured_key?: string
  signature_before: PageSignature
  signature_after: PageSignature
  signature_changed: boolean
  /** Winning vision-council provider for this step's decision (e.g. "gemini"). */
  provider?: string
  /** Model name reported by the winning provider's adapter. */
  model?: string
  latency_ms?: number
  usage?: Record<string, unknown>
}

export async function executeAction(input: {
  page: Page
  action: AgentAction
  marks: MarkDescriptor[]
  screenshotsDir: string
  ordinal: number
  guard: GuardContext
  profile: TargetProfile
  /** The same map runStep() populates in template mode; capture_table writes into it live. */
  tables: Record<string, Array<Record<string, string>>>
}): Promise<ActionOutcome> {
  const { page, action, marks } = input
  const before = await signature(page)
  const descriptor = 'mark' in action ? marks.find((item) => item.mark === action.mark) : undefined
  const targetLabel = descriptor?.name ?? ''
  let guard: GuardDecision = { allowed: true }
  let status: ActionOutcome['status'] = 'executed'
  let observation = ''
  let typedValue: string | undefined
  let capturedKey: string | undefined

  if (action.type === 'done' || action.type === 'blocked' || action.type === 'ask_operator') {
    status = 'terminal'
    observation = action.type === 'ask_operator' ? action.question : action.reason
  } else {
    guard = guardAction(action, descriptor, input.guard, input.profile)
    if (!guard.allowed) {
      status = 'refused'
      observation = `That control is destructive or disallowed on this tier: ${guard.reason ?? 'blocked by safety guard'}. Choose another action.`
    } else {
      try {
        const performed = await perform(page, action, descriptor, input.tables)
        typedValue = performed.typedValue
        capturedKey = performed.capturedKey
        observation = `Executed ${describeAction(action, targetLabel)}`
          + `${typedValue ? ` with "${typedValue}"` : ''}`
          + `${capturedKey ? ` (captured "${capturedKey}")` : ''}.`
      } catch (error) {
        status = 'failed'
        observation = `Action failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  await markInteractive(page)
  const after = await signature(page)
  await unmark(page)
  const shot = await captureViewportJpeg(
    page,
    input.screenshotsDir,
    `agent-step-${String(input.ordinal).padStart(3, '0')}-${action.type}`,
  )
  return {
    status,
    observation,
    guard,
    screenshot: shot.path,
    before,
    after,
    target_label: targetLabel,
    typed_value: typedValue,
    captured_key: capturedKey,
  }
}

function guardAction(
  action: AgentAction,
  descriptor: MarkDescriptor | undefined,
  guardCtx: GuardContext,
  profile: TargetProfile,
): GuardDecision {
  if (action.type === 'navigate') {
    const host = evaluateHostGuard({
      currentUrl: action.url,
      baseUrl: profile.base_url,
      allowedDomains: profile.allowed_domains,
    })
    return host.ok ? { allowed: true } : { allowed: false, reason: host.message ?? 'host not allowed' }
  }
  if (action.type === 'type' || action.type === 'select') {
    if (!descriptor) return { allowed: false, reason: `mark ${action.mark} is not present` }
    // Typing never commits — gate on credential/statutory patterns, not the click vocabulary.
    if (isUnsafeToFill({
      tag: (descriptor.tag === 'select' || descriptor.tag === 'textarea' ? descriptor.tag : 'input'),
      type: descriptor.type,
      name: descriptor.name,
      id: '',
      placeholder: '',
      ariaLabel: descriptor.name,
      label: descriptor.name,
      required: false,
    })) {
      return {
        allowed: false,
        reason: 'field is credential, OTP, or a statutory identifier and must not be filled',
        matchedToken: descriptor.name,
      }
    }
    return { allowed: true }
  }
  if (action.type === 'click'
    || (action.type === 'press' && action.key.toLowerCase() === 'enter')) {
    if ('mark' in action && !descriptor) return { allowed: false, reason: `mark ${action.mark} is not present` }
    const verdict = isBlocked(descriptor?.name ?? action.type, guardCtx)
    return verdict.blocked
      ? { allowed: false, reason: verdict.match ?? 'blocked by safety guard', matchedToken: verdict.match }
      : { allowed: true }
  }
  return { allowed: true }
}

async function perform(
  page: Page,
  action: AgentAction,
  descriptor: MarkDescriptor | undefined,
  tables: Record<string, Array<Record<string, string>>>,
): Promise<{ typedValue?: string; capturedKey?: string }> {
  let typedValue: string | undefined
  let capturedKey: string | undefined
  switch (action.type) {
    case 'click':
      await page.locator(`[data-qa-mark="${action.mark}"]`).click({ timeout: 10_000 })
      break
    case 'type': {
      const target = page.locator(`[data-qa-mark="${action.mark}"]`)
      const hint = { type: descriptor?.type, name: descriptor?.name, tag: descriptor?.tag }
      typedValue = applyMarker(coerceForField(action.text, hint), hint)
      await target.fill(typedValue, { timeout: 10_000 })
      if (action.submit) await target.press('Enter')
      break
    }
    case 'select':
      await page.locator(`[data-qa-mark="${action.mark}"]`).selectOption({ label: action.option })
        .catch(() => page.locator(`[data-qa-mark="${action.mark}"]`).selectOption(action.option))
      break
    case 'press':
      await page.keyboard.press(action.key)
      break
    case 'scroll':
      await page.mouse.wheel(0, (action.direction === 'down' ? 1 : -1) * Math.max(100, Math.min(2000, action.amount)))
      break
    case 'navigate':
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {})
      break
    case 'wait':
      await page.waitForTimeout(Math.max(0, Math.min(10_000, action.ms)))
      break
    case 'capture_table': {
      const rows = await extractTableAtMark(page, action.mark)
      if (rows === null) throw new Error(`mark ${action.mark} is not a table and has no enclosing <table>`)
      tables[action.key] = rows
      capturedKey = action.key
      break
    }
    case 'done':
    case 'blocked':
    case 'ask_operator':
      break
  }
  if (action.type !== 'wait' && action.type !== 'done' && action.type !== 'blocked'
    && action.type !== 'ask_operator' && action.type !== 'capture_table') {
    await waitForSettle(page)
  }
  return { typedValue, capturedKey }
}

/**
 * Duplicated in miniature from stepRunner.ts's readTable() (header row + body
 * rows keyed by header text, numeric index fallback) rather than exported
 * from there, so template mode's read path stays untouched.
 */
async function extractTableAtMark(page: Page, mark: number): Promise<Array<Record<string, string>> | null> {
  return page.evaluate<Array<Record<string, string>> | null, number>((markValue) => {
    const el = document.querySelector(`[data-qa-mark="${markValue}"]`)
    if (!el) return null
    const table = el.tagName.toLowerCase() === 'table' ? el : el.closest('table')
    if (!table) return null
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((c) => (c as HTMLElement).innerText.trim()))
    const [header, ...body] = rows
    if (!header) return []
    return body.map((row) => Object.fromEntries(row.map((v, i) => [header[i] || String(i), v])))
  }, mark)
}

function describeAction(action: AgentAction, label: string): string {
  if ('mark' in action) {
    return label
      ? `${action.type} "${label}" (mark ${action.mark})`
      : `${action.type} on mark ${action.mark}`
  }
  if (action.type === 'navigate') return `navigate to ${action.url}`
  return action.type
}
