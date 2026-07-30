/**
 * safeActionGuard — refuses destructive / compliance actions when running on a
 * production target. Used by stepRunner to wrap every click/submit step.
 *
 * The matched action texts are configured in `qa_settings.restricted_action_words`,
 * but defaults are baked in so the worker is safe even if settings aren't reachable.
 */

import type { Page } from 'playwright'
import { isObserverOnly, isProduction, normalizeEnvironment, type Environment } from './environments.js'

const DEFAULT_RESTRICTED = [
  'Delete', 'Remove', 'Reset',
  'Finalize', 'Finalise',
  'File Return',
  'Generate E-Invoice', 'Generate E-Way Bill', 'Submit to GST',
  'Sync Live',
  'Approve', 'Reject',
  'Post Permanently',
]

export const OBSERVER_ONLY_FILE_BLOCK_REASON =
  'Observer-only environment: file uploads and mutating downloads are never attempted.'

export interface GuardContext {
  environment: Environment | string
  productionUnlocked: boolean
  restrictedWords?: string[]
  /** Profile-level opt-in required before any synthetic file is uploaded. */
  allowSafeDemo?: boolean
}

export class SafeActionBlocked extends Error {
  constructor(public action: string, public match: string) {
    super(`safeActionGuard blocked action "${action}" (matched: "${match}").`)
    this.name = 'SafeActionBlocked'
  }
}

export function isBlocked(label: string, ctx: GuardContext): { blocked: boolean; match?: string } {
  const env = normalizeEnvironment(ctx.environment)

  // Observer-only tiers refuse destructive labels even with the owner unlock on.
  if (isObserverOnly(env)) {
    const words = ctx.restrictedWords?.length ? ctx.restrictedWords : DEFAULT_RESTRICTED
    for (const w of words) {
      if (label.toLowerCase().includes(w.toLowerCase())) {
        return { blocked: true, match: w }
      }
    }
    return { blocked: false }
  }

  if (!isProduction(env) || ctx.productionUnlocked) {
    return { blocked: false }
  }

  const words = ctx.restrictedWords?.length ? ctx.restrictedWords : DEFAULT_RESTRICTED
  for (const w of words) {
    if (label.toLowerCase().includes(w.toLowerCase())) {
      return { blocked: true, match: w }
    }
  }
  return { blocked: false }
}

/** Whether this context may move a synthetic file into or out of the target. */
export function fileActionsAllowed(ctx: GuardContext): { allowed: boolean; reason?: string } {
  if (isObserverOnly(ctx.environment)) {
    return { allowed: false, reason: OBSERVER_ONLY_FILE_BLOCK_REASON }
  }
  if (ctx.allowSafeDemo === false) {
    return {
      allowed: false,
      reason: 'Target profile has allow_safe_demo turned off, so synthetic uploads are skipped.',
    }
  }
  return { allowed: true }
}

/**
 * Wrap a click on a DOM element: inspects its visible text + selector text,
 * throws SafeActionBlocked when the action looks destructive on prod.
 */
export async function guardedClick(page: Page, selector: string, ctx: GuardContext): Promise<void> {
  const locator = page.locator(selector)
  const label = (await locator.first().innerText().catch(() => '')) || selector
  const v = isBlocked(label, ctx)
  if (v.blocked) {
    throw new SafeActionBlocked(label, v.match || '')
  }
  await locator.first().click()
}
