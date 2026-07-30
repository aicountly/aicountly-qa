/**
 * Vision agent loop, ported from aicountly-smoke-app's agent/agentLoop.ts.
 * Keeps the action budget, loop detection, scroll-stall warning, blocked-
 * refutation retry, per-step decision-JPEG cleanup and screenshot thinning.
 *
 * QA-specific: the system prompt is data-quality framed (enter deterministic
 * pack data, then capture the contract's tables) rather than smoke's
 * creation/explore framing, and a new evaluateDoneDecision() refuses `done`
 * while required capture_table keys are still missing. smoke's dateFieldProbe
 * integration (UX-locale findings) has no QA equivalent and is dropped.
 */

import fs from 'node:fs/promises'
import type { Page } from 'playwright'
import { BrainUnavailableError, invokeBrain } from '../brain/ensemble.js'
import { config } from '../utils/config.js'
import { requestFormValues } from '../data/syntheticData.js'
import { askOrRecallDecision } from '../nav/askDecision.js'
import type { GuardContext } from '../utils/safeActionGuard.js'
import type { DecisionOption, Run, Session, TargetProfile } from '../types.js'
import { executeAction, type AgentAction, type AgentStepRecord } from './actions.js'
import { countOffscreen, markInteractive, type MarkDescriptor } from './marks.js'
import {
  captureViewportJpeg,
  scrollExtent,
  signature,
  signatureKey,
  type PageSignature,
} from './perceive.js'

export type AgentLoopResult = {
  status: 'done' | 'blocked' | 'budget' | 'operator' | 'contract_unmet'
  reason: string
  steps: AgentStepRecord[]
  screenCount: number
}

type ModelDecision = {
  observation: string
  reasoning: string
  action: AgentAction
  goal_progress: string
  blockers: string[]
}

const SYSTEM_PROMPT = `You are a QA data-quality agent operating a signed-in business SaaS app.
Use only numbered Set-of-Marks controls supplied in the prompt. Never invent selectors or marks.

Data entry (do this first, wherever the session calls for it):
- Enter this session's deterministic test data into the relevant fields, preferring suggested_values
  when present.
- Free-TEXT values you type MUST begin with "QA-" (emails may use a qa. local-part). Never prefix a
  value a validator reads as a number: phone/mobile/WhatsApp numbers, amounts, quantities, PIN codes,
  dates and times are typed bare. Dates may be typed as dd/mm/yyyy.
- Never fill credential, OTP, captcha, password, GSTIN, PAN, Aadhaar, bank account, IFSC or CIN fields.
  The safety guard refuses these anyway, but never attempt them.

Route and capture contract (the point of this run):
- suggested_path is this session's own template steps — follow it as your default route unless a
  control has clearly moved (selector drift), in which case find the equivalent control yourself.
  It is a hint, never something you execute literally.
- capture_contract lists the metric/table keys this session must record before it may finish.
  Navigate to whichever report or screen holds each figure, then use the capture_table action
  (mark of the table or a cell inside it, plus a key drawn from capture_contract) to record it.
  captured_keys / missing_keys in the prompt tell you what is already covered.
- Do not declare done while missing_keys is non-empty — capture the remaining tables first.
- Never click destructive or statutory-filing controls (delete, remove, approve, reject, pay, refund,
  void, transfer, send, efile, close period, finalize) unless this session's own QA- marked record is
  what you are acting on. Never sign out.
- Treat safety-guard refusals as expected and route around them — do not retry the same refused control.
- Bare Cancel / Close / Dismiss / Back may be used freely to clear modals and return from forms.

Reading the elements list:
- It covers the whole page, not just the visible part. Entries flagged "offscreen":true sit outside
  the viewport (viewport_offset is pixels above, if negative, or below, if positive) and carry no
  badge in the screenshot. Clicking one still works: it is scrolled into view first.
- A control you saw earlier and cannot find now is almost always below the fold, not missing.
  Scroll to it or click its offscreen mark before concluding the app has no such control.
- After submitting a form, read the validation messages on screen and fix the named fields rather
  than resubmitting unchanged.

Return JSON only:
{"observation":"","reasoning":"","action":{"type":"click","mark":1},"goal_progress":"","blockers":[]}
Allowed action types: click, type, select, press, scroll, navigate, wait, capture_table, done, blocked, ask_operator.
capture_table looks like {"type":"capture_table","mark":7,"key":"tb_debit_total"}.`

const SYNTHETIC_DATA_CALL_CAP = 8

export async function runAgentLoop(input: {
  page: Page
  session: Session
  run: Run
  profile: TargetProfile
  guard: GuardContext
  goal: string
  budget: number
  screenshotsDir: string
  /** The template's own steps[], JSON-stringified into the prompt as a hint — never executed. */
  suggestedPath: unknown
  /** Required table/metric keys drawn from validations[] + expected-result metric keys. */
  captureContract: string[]
  /** The same map runStep() populates in template mode; capture_table writes into it live. */
  tables: Record<string, Array<Record<string, string>>>
  onStep?: (step: AgentStepRecord) => Promise<void>
  onLoopWarning?: (message: string) => Promise<void>
}): Promise<AgentLoopResult> {
  const steps: AgentStepRecord[] = []
  const recentTriples: string[] = []
  let priorSignature = await signature(input.page)
  let unchangedCount = 0
  let stuckWarnings = 0
  let feedback = ''
  const suggestedCache = new Map<string, Record<string, string>>()
  let syntheticDataCalls = 0
  let blockedRefusals = 0
  let doneRefusals = 0
  let consecutiveScrolls = 0
  let deepestScrollSeen = 0
  const budget = Math.max(1, input.budget)

  for (let ordinal = 1; ordinal <= budget; ordinal += 1) {
    const marks = await markInteractive(input.page)
    const markedShot = await captureViewportJpeg(
      input.page,
      input.screenshotsDir,
      `agent-decision-${String(ordinal).padStart(3, '0')}`,
    )
    const current = await signature(input.page)
    const suggestedValues = await loadSuggestedValues({
      page: input.page,
      session: input.session,
      profile: input.profile,
      marks,
      current,
      cache: suggestedCache,
      callBudget: {
        used: syntheticDataCalls,
        maximum: SYNTHETIC_DATA_CALL_CAP,
        consume: () => { syntheticDataCalls += 1 },
      },
    })
    const history = steps.slice(-6).map((step) => ({
      action: step.action,
      outcome: step.outcome,
      observation: step.outcome_observation,
      url: step.signature_after.url,
      target: step.target_label,
    }))
    const scroll = await scrollExtent(input.page)
    deepestScrollSeen = Math.max(deepestScrollSeen, scroll.y)
    const submitted = submittedControls(steps)
    const capturedKeys = Object.keys(input.tables)
    const missingKeys = input.captureContract.filter((key) => !capturedKeys.includes(key))
    const prompt = JSON.stringify({
      goal: input.goal,
      current: { url: current.url, title: current.title },
      elements: marks,
      viewport: {
        scroll_y: scroll.y,
        max_scroll_y: scroll.maxY,
        height: scroll.height,
        offscreen_controls: countOffscreen(marks),
      },
      session_facts: submitted.length ? { submit_controls_already_clicked: submitted } : undefined,
      suggested_values: Object.keys(suggestedValues).length ? suggestedValues : undefined,
      suggested_path: input.suggestedPath,
      capture_contract: input.captureContract,
      captured_keys: capturedKeys,
      missing_keys: missingKeys,
      recent_actions: history,
      prior_feedback: feedback || undefined,
      budget: { step: ordinal, maximum: budget },
      stuck_warning: stuckWarnings > 0
        ? 'The page/action pattern is repeating without screen change. Choose a materially different action or return blocked.'
        : undefined,
      scroll_warning: consecutiveScrolls >= 3
        ? 'You have scrolled three times in a row without acting. Act on a control now, or say precisely which control is missing.'
        : undefined,
    })
    let response: Awaited<ReturnType<typeof invokeBrain>>
    try {
      response = await invokeBrain(
        'vision_agent',
        SYSTEM_PROMPT,
        prompt,
        {
          expect_json: true,
          product: input.profile.product_name,
          environment: String(input.profile.environment),
          session_id: input.session.id,
        },
        [{ mime_type: 'image/jpeg', data: markedShot.base64 }],
      )
    } finally {
      await fs.unlink(markedShot.path).catch(() => {})
    }
    const decision = parseDecision(response.final)
    // The adapter response shape (provider/model/output/raw/usage/latency_ms/sources)
    // flows through unmodified from the PHP brain adapters (AbstractAdapter subclasses).
    const providerResult = (response.parallel as Record<string, Record<string, unknown>> | null | undefined)
      ?.[response.arbiter]
    const outcome = await executeAction({
      page: input.page,
      action: decision.action,
      marks,
      screenshotsDir: input.screenshotsDir,
      ordinal,
      guard: input.guard,
      profile: input.profile,
      tables: input.tables,
    })
    const changed = signatureKey(outcome.before) !== signatureKey(outcome.after)
    // "I cannot find the button" is refutable from what this session already did.
    // Push back once, then respect the answer so the loop always terminates.
    const blockedRefutation = decision.action.type === 'blocked'
      ? evaluateBlockedDecision({
        steps,
        submitted,
        scroll: { y: scroll.y, maxY: scroll.maxY, deepestSeen: deepestScrollSeen },
        refusalsUsed: blockedRefusals,
      })
      : null
    const doneMissing = decision.action.type === 'done'
      ? input.captureContract.filter((key) => !Object.keys(input.tables).includes(key))
      : []
    const doneRefutation = (decision.action.type === 'done' && doneMissing.length > 0)
      ? evaluateDoneDecision({ required: input.captureContract, captured: Object.keys(input.tables), refusalsUsed: doneRefusals })
      : null
    const refutation = blockedRefutation ?? doneRefutation
    const step: AgentStepRecord = {
      ordinal,
      captured_at: new Date().toISOString(),
      screenshot: outcome.screenshot ?? '',
      observation: decision.observation,
      reasoning: decision.reasoning,
      goal_progress: decision.goal_progress,
      blockers: decision.blockers,
      action: decision.action,
      outcome: refutation ? 'refused' : outcome.status,
      outcome_observation: refutation ?? outcome.observation,
      guard: outcome.guard,
      target_label: outcome.target_label,
      typed_value: outcome.typed_value,
      captured_key: outcome.captured_key,
      signature_before: outcome.before,
      signature_after: outcome.after,
      signature_changed: changed,
      provider: response.arbiter,
      model: typeof providerResult?.model === 'string' ? providerResult.model : undefined,
      latency_ms: typeof providerResult?.latency_ms === 'number' ? providerResult.latency_ms : undefined,
      usage: providerResult?.usage && typeof providerResult.usage === 'object'
        ? providerResult.usage as Record<string, unknown>
        : undefined,
    }
    steps.push(step)
    await thinStepScreenshots(steps, config.stepScreenshotRetention)
    await input.onStep?.(step)
    feedback = step.outcome_observation
    consecutiveScrolls = decision.action.type === 'scroll' ? consecutiveScrolls + 1 : 0

    const loop = evaluateLoopDetection({
      action: decision.action,
      before: outcome.before,
      after: outcome.after,
      recentTriples,
      unchangedCount,
      priorSignature,
    })
    recentTriples.splice(0, recentTriples.length, ...loop.recentTriples)
    unchangedCount = loop.unchangedCount
    priorSignature = loop.priorSignature
    if (loop.warned) {
      stuckWarnings += 1
      feedback += ' Loop detection fired; take a different route.'
      await input.onLoopWarning?.(
        `Loop detection warning ${stuckWarnings}/3: stalled action pattern or unchanged page.`,
      )
      if (stuckWarnings >= 3) {
        return {
          status: 'blocked',
          reason: 'Repeated actions or unchanged page after three warnings.',
          steps,
          screenCount: steps.length,
        }
      }
    }

    if (decision.action.type === 'done') {
      if (doneMissing.length === 0) {
        return { status: 'done', reason: decision.action.reason, steps, screenCount: steps.length }
      }
      if (doneRefutation) {
        doneRefusals += 1
        await input.onLoopWarning?.(`Refused a premature done: ${doneRefutation}`)
      } else {
        return {
          status: 'contract_unmet',
          reason: `Capture contract still missing after ${doneRefusals} refusal(s): ${doneMissing.join(', ')}`,
          steps,
          screenCount: steps.length,
        }
      }
    }
    if (decision.action.type === 'blocked') {
      if (!blockedRefutation) {
        return { status: 'blocked', reason: decision.action.reason, steps, screenCount: steps.length }
      }
      blockedRefusals += 1
      await input.onLoopWarning?.(`Refused a premature blocked: ${blockedRefutation}`)
    }
    if (decision.action.type === 'ask_operator') {
      const operator = await escalateToOperator(input, decision.action, outcome.screenshot)
      if (operator === 'abort_session') {
        return { status: 'operator', reason: decision.action.question, steps, screenCount: steps.length }
      }
      feedback = 'Operator requested that the agent continue and try a different route.'
    }
  }
  return { status: 'budget', reason: `Action budget of ${budget} exhausted.`, steps, screenCount: steps.length }
}

/** Exported for unit tests — pure loop-detection state update. */
export function evaluateLoopDetection(input: {
  action: AgentAction
  before: PageSignature
  after: PageSignature
  recentTriples: string[]
  unchangedCount: number
  priorSignature: PageSignature
}): {
  recentTriples: string[]
  unchangedCount: number
  priorSignature: PageSignature
  warned: boolean
} {
  const changed = signatureKey(input.before) !== signatureKey(input.after)
  const recentTriples = [...input.recentTriples]
  let unchangedCount = signatureKey(input.priorSignature) === signatureKey(input.after)
    ? input.unchangedCount + 1
    : 0

  if (changed) {
    recentTriples.length = 0
  } else {
    const triple = actionTriple(input.action, input.before)
    recentTriples.push(triple)
    if (recentTriples.length > 12) recentTriples.shift()
  }

  const tripleRepeats = !changed
    && recentTriples.filter((value) => value === actionTriple(input.action, input.before)).length >= 5
  const warned = tripleRepeats || unchangedCount >= 6
  if (warned) unchangedCount = 0

  return {
    recentTriples,
    unchangedCount,
    priorSignature: input.after,
    warned,
  }
}

export type SubmittedControl = { mark: number; label: string; step: number }

/** Labels used only for the submittedControls() heuristic — narrow on purpose. */
const CONSTRUCTIVE_REGEX = /\b(save|submit|upload|import|apply|confirm|assign|activate|enable)\b/i

/**
 * Labels that commit a form. Wider than the safety guard's restricted
 * vocabulary, which leaves out create and add on purpose so that an agent
 * may still open a create form. Bare "add" stays out here too, because
 * "Add Employee" opens the form rather than saving it.
 */
const COMMITS_FORM = /\b(create|update|register|generate|insert|post)\b/i

/** Save/create controls this session has already clicked successfully. */
export function submittedControls(steps: AgentStepRecord[]): SubmittedControl[] {
  const seen = new Map<string, SubmittedControl>()
  for (const step of steps) {
    if (step.action.type !== 'click' || step.outcome !== 'executed') continue
    const label = step.target_label
    if (!CONSTRUCTIVE_REGEX.test(label) && !COMMITS_FORM.test(label)) continue
    const key = step.target_label.trim().toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, { mark: step.action.mark, label: step.target_label, step: step.ordinal })
    }
  }
  return [...seen.values()]
}

/**
 * A reason to send the agent back rather than end the session, or null to
 * accept the block. Judged on what the session did, never on how the model
 * phrased it: a model that has already clicked "Create employee master"
 * three times cannot also be right that no such control exists.
 */
export function evaluateBlockedDecision(input: {
  steps: AgentStepRecord[]
  submitted: SubmittedControl[]
  scroll: { y: number; maxY: number; deepestSeen: number }
  refusalsUsed: number
}): string | null {
  if (input.refusalsUsed >= 1) return null
  if (input.submitted.length) {
    const list = input.submitted
      .map((control) => `"${control.label}" (mark ${control.mark}, step ${control.step})`)
      .join(', ')
    return `This session already clicked ${list} successfully, so that control exists on this screen. `
      + 'Controls outside the viewport are still listed with offscreen:true and are still clickable. '
      + 'Scroll to the submit control, read any validation message next to the fields it names, '
      + 'correct those fields and submit again.'
  }
  const unseen = input.scroll.maxY - input.scroll.deepestSeen
  if (unseen > 200) {
    return `About ${unseen}px of this page has never been on screen, and the elements list already `
      + 'includes what is down there. Scroll down and act on the controls you find before giving up.'
  }
  return null
}

/**
 * Refuse `done` while the capture contract is unmet, mirroring
 * evaluateBlockedDecision's one-free-refusal shape (here: two refusals).
 * Exported for unit tests.
 */
export function evaluateDoneDecision(input: {
  required: string[]
  captured: string[]
  refusalsUsed: number
}): string | null {
  const missing = input.required.filter((key) => !input.captured.includes(key))
  if (!missing.length) return null
  if (input.refusalsUsed >= 2) return null
  return `The capture contract is not yet satisfied: still missing ${missing.join(', ')}. `
    + 'Use capture_table to record each of these before declaring done.'
}

function isEmptyFillableMark(mark: MarkDescriptor): boolean {
  const tag = mark.tag.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false
  if (mark.disabled) return false
  const type = mark.type.toLowerCase()
  if (['hidden', 'password', 'file', 'submit', 'button', 'checkbox', 'radio', 'image'].includes(type)) {
    return false
  }
  return !String(mark.value || '').trim()
}

/** Exported for unit tests — stable form identity for synthetic_data caching. */
export function formIdentityKey(current: PageSignature, marks: MarkDescriptor[]): string {
  const names = marks
    .filter((mark) => {
      const tag = mark.tag.toLowerCase()
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false
      if (mark.disabled) return false
      const type = mark.type.toLowerCase()
      return !['hidden', 'password', 'file', 'submit', 'button', 'checkbox', 'radio', 'image'].includes(type)
    })
    .map((mark) => mark.name || `${mark.tag}:${mark.type}`)
    .sort()
  // Form identity — URL + title + field names. Deliberately omits domHash so
  // progressive filling of the same form reuses one synthetic_data response.
  return `${current.url}|${current.title}|${names.join('|')}`
}

async function loadSuggestedValues(input: {
  page: Page
  session: Session
  profile: TargetProfile
  marks: MarkDescriptor[]
  current: PageSignature
  cache: Map<string, Record<string, string>>
  callBudget: { used: number; maximum: number; consume: () => void }
}): Promise<Record<string, string>> {
  const emptyFields = input.marks.filter(isEmptyFillableMark)
  if (emptyFields.length < 3) return {}
  const cacheKey = formIdentityKey(input.current, input.marks)
  const cached = input.cache.get(cacheKey)
  if (cached) return cached
  if (input.callBudget.used >= input.callBudget.maximum) return {}
  try {
    input.callBudget.consume()
    const result = await requestFormValues({
      marks: input.marks,
      product: input.profile.product_name,
      environment: String(input.profile.environment),
      sessionName: input.session.name,
      url: input.current.url,
    })
    input.cache.set(cacheKey, result.fields)
    return result.fields
  } catch (error) {
    if (error instanceof BrainUnavailableError) throw error
    return {}
  }
}

function parseDecision(value: unknown): ModelDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision model returned a non-object decision.')
  }
  const row = value as Record<string, unknown>
  const action = parseAgentAction(row.action)
  return {
    observation: String(row.observation ?? ''),
    reasoning: String(row.reasoning ?? ''),
    action,
    goal_progress: String(row.goal_progress ?? ''),
    blockers: Array.isArray(row.blockers) ? row.blockers.map(String) : [],
  }
}

export function parseAgentAction(value: unknown): AgentAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Vision decision has no action object.')
  const action = value as Record<string, unknown>
  const type = String(action.type ?? '')
  if (type === 'click') return { type, mark: positiveMark(action.mark) }
  if (type === 'type') return { type, mark: positiveMark(action.mark), text: String(action.text ?? ''), submit: Boolean(action.submit) }
  if (type === 'select') return { type, mark: positiveMark(action.mark), option: String(action.option ?? '') }
  if (type === 'press') return { type, key: String(action.key ?? '') || 'Escape' }
  if (type === 'scroll') return {
    type,
    direction: action.direction === 'up' ? 'up' : 'down',
    amount: Math.max(100, Math.min(2000, Number(action.amount) || 700)),
  }
  if (type === 'navigate') return { type, url: String(action.url ?? '') }
  if (type === 'wait') return { type, ms: Math.max(0, Number(action.ms) || 500) }
  if (type === 'capture_table') {
    return { type, mark: positiveMark(action.mark), key: String(action.key ?? '').trim() || `table_${Date.now()}` }
  }
  if (type === 'done' || type === 'blocked') return { type, reason: String(action.reason ?? '') }
  if (type === 'ask_operator') return {
    type,
    question: String(action.question ?? 'How should the QA run proceed?'),
    options: Array.isArray(action.options) ? action.options.map(String) : [],
  }
  throw new Error(`Vision decision contains unsupported action type "${type}".`)
}

function positiveMark(value: unknown): number {
  const mark = Number(value)
  if (!Number.isInteger(mark) || mark <= 0) throw new Error(`Invalid Set-of-Marks target "${String(value)}".`)
  return mark
}

export function actionTriple(action: AgentAction, sig: PageSignature): string {
  return `${action.type}|${'mark' in action ? action.mark : ''}|${signatureKey(sig)}`
}

async function escalateToOperator(
  input: Parameters<typeof runAgentLoop>[0],
  action: Extract<AgentAction, { type: 'ask_operator' }>,
  screenshotPath?: string,
): Promise<string> {
  const options: DecisionOption[] = [
    { id: 'continue', label: action.options[0] || 'Continue and try another route', action: 'rescan_menus' },
    { id: 'abort_session', label: 'Abort this session', action: 'abort_session' },
  ]
  const choice = await askOrRecallDecision({
    page: input.page,
    session: input.session,
    run: input.run,
    profile: input.profile,
    situationKey: `vision_agent:${action.question}`.slice(0, 191),
    question: action.question,
    options,
    screenshotPath,
    // Distinguishes an AI-driven mid-run decision from a template-driven human one.
    context: { source: 'ai', offered_options: action.options },
  })
  return choice.option.id
}

/** Keep the newest N step screenshots on disk; older ones stay in the timeline without files. */
async function thinStepScreenshots(steps: AgentStepRecord[], keep: number): Promise<void> {
  const withShots = steps.filter((step) => step.screenshot)
  const excess = withShots.length - keep
  if (excess <= 0) return
  for (const step of withShots.slice(0, excess)) {
    const path = step.screenshot
    step.screenshot = ''
    await fs.unlink(path).catch(() => {})
  }
}
