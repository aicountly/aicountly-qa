/**
 * Mid-run operator decisions (awaiting_decision).
 * Plain question/options — no smoke phrasing / brain layer.
 */

import type { Page } from 'playwright'
import {
  createDecision,
  getDecision,
  getDecisionMemory,
  heartbeat,
  timeoutDecision,
} from '../apiClient.js'
import type { DecisionOption, DecisionRow, Run, Session, TargetProfile } from '../types.js'

export type DecisionChoice = {
  option: DecisionOption
  source: 'memory' | 'human'
}

export type AskDecisionInput = {
  page: Page
  session: Session
  run: Run
  profile: TargetProfile
  situationKey: string
  question: string
  options: DecisionOption[]
  context?: Record<string, unknown>
  screenshotPath?: string
  pollIntervalMs?: number
  timeoutMs?: number
}

const DEFAULT_POLL_MS = 2_000
const DEFAULT_TIMEOUT_MS = 30 * 60_000

export async function askOrRecallDecision(input: AskDecisionInput): Promise<DecisionChoice> {
  if (!input.options.length) throw new Error('A decision requires at least one option.')

  const memory = await getDecisionMemory({
    product_name: input.profile.product_name || input.run.product_name,
    environment: input.profile.environment || input.run.environment,
    situation_key: input.situationKey,
  }).catch(() => null)

  const rememberedId = memory?.selected_option?.trim()
  if (rememberedId) {
    const option = input.options.find((o) => o.id === rememberedId)
    if (option) {
      await createDecision({
        session_id: input.session.id,
        qa_run_id: input.session.qa_run_id,
        situation_key: input.situationKey,
        question: input.question,
        options_json: input.options,
        context_json: {
          ...(input.context ?? {}),
          url: input.page.url(),
          title: await input.page.title().catch(() => ''),
          source: 'memory',
        },
        screenshot_path: input.screenshotPath,
        memory_applied: true,
        selected_option: option.id,
      }).catch(() => null)
      console.log(`[aicountly-qa-worker] Decision memory applied: ${option.label}`)
      return { option, source: 'memory' }
    }
    console.warn(`[aicountly-qa-worker] Ignored invalid remembered decision for ${input.situationKey}`)
  }

  const created = await createDecision({
    session_id: input.session.id,
    qa_run_id: input.session.qa_run_id,
    situation_key: input.situationKey,
    question: input.question,
    options_json: input.options,
    context_json: {
      ...(input.context ?? {}),
      url: input.page.url(),
      title: await input.page.title().catch(() => ''),
      source: 'human',
    },
    screenshot_path: input.screenshotPath,
    memory_applied: false,
  })

  const decisionId = Number(created.id)
  if (!decisionId) throw new Error('Decision API did not return a decision id.')

  console.log(`[aicountly-qa-worker] Awaiting decision #${decisionId} (${input.situationKey})`)

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = input.pollIntervalMs ?? DEFAULT_POLL_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await heartbeat(input.session.id, {
      message: `Awaiting operator decision: ${input.situationKey}`,
      step: input.situationKey,
      metadata: { decision_id: decisionId, status: 'awaiting_decision' },
    }).catch(() => null)

    let row: DecisionRow | null = null
    try {
      row = await getDecision(decisionId)
    } catch {
      await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
      continue
    }

    if (row.status === 'answered') {
      const option = resolveOption(row.selected_option ?? '', row.options_json ?? input.options)
      if (!option) throw new Error(`Decision ${decisionId} returned unknown option "${row.selected_option}".`)
      console.log(`[aicountly-qa-worker] Decision answered: ${option.label}`)
      return { option, source: 'human' }
    }
    if (row.status === 'cancelled' || row.status === 'timed_out') {
      throw new Error(`Decision ${decisionId} was ${row.status}.`)
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
  }

  await timeoutDecision(decisionId).catch(() => null)
  throw new Error(`Timed out waiting ${Math.round(timeoutMs / 60_000)} minutes for decision ${decisionId}.`)
}

function resolveOption(selected: string, options: DecisionOption[]): DecisionOption | null {
  return options.find((o) => o.id === selected) ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
