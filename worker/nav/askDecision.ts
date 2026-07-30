/**
 * Mid-run operator decisions (awaiting_decision).
 * Plain question/options — no smoke phrasing / brain layer.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import {
  createDecision,
  getDecision,
  getDecisionMemory,
  heartbeat,
  timeoutDecision,
  uploadEvidence,
} from '../apiClient.js'
import type { DecisionOption, DecisionRow, Run, Session, TargetProfile } from '../types.js'
import { normalizeEnvironment } from '../utils/environments.js'

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
    environment: normalizeEnvironment(input.profile.environment || input.run.environment),
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

  // The operator card is far easier to answer with a picture of the blocked screen.
  const screenshotPath = input.screenshotPath
    ?? await captureDecisionScreenshot(input.page, input.session.id, input.situationKey)

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
    screenshot_path: screenshotPath,
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

/**
 * Screenshot the blocked screen and upload it as session evidence, returning the
 * server-side path the API stored it at so the decision card can render it.
 * A failure here must never stop the decision from being raised.
 */
async function captureDecisionScreenshot(
  page: Page,
  sessionId: number,
  situationKey: string,
): Promise<string | undefined> {
  try {
    const dir = await mkdtemp(join(tmpdir(), 'qa-decision-'))
    const name = `decision-${slug(situationKey)}-${Date.now()}.png`
    const localPath = join(dir, name)
    await page.screenshot({ path: localPath, fullPage: false })
    // Only the API-side path is usable: the portal serves decision screenshots
    // from inside the reports root, so a worker-local temp path would only ever
    // 404. Leaving it unset makes the card say "no screenshot" instead.
    return (await uploadEvidence(sessionId, localPath, 'decision')) ?? undefined
  } catch {
    return undefined
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
