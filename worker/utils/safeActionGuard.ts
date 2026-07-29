/**
 * safeActionGuard — refuses destructive / compliance actions when running on a
 * production target. Used by stepRunner to wrap every click/submit step.
 *
 * The matched action texts are configured in `qa_settings.restricted_action_words`,
 * but defaults are baked in so the worker is safe even if settings aren't reachable.
 */

import type { Page } from 'playwright'

const DEFAULT_RESTRICTED = [
  'Delete', 'Remove', 'Reset',
  'Finalize', 'Finalise',
  'File Return',
  'Generate E-Invoice', 'Generate E-Way Bill', 'Submit to GST',
  'Sync Live',
  'Approve', 'Reject',
  'Post Permanently',
]

export interface GuardContext {
  environment: 'sandbox' | 'gh' | 'prod_basic' | 'prod_full'
  productionUnlocked: boolean
  restrictedWords?: string[]
}

export class SafeActionBlocked extends Error {
  constructor(public action: string, public match: string) {
    super(`safeActionGuard blocked action "${action}" (matched: "${match}").`)
    this.name = 'SafeActionBlocked'
  }
}

function isProductionTarget(env: GuardContext['environment']): boolean {
  return env === 'prod_basic' || env === 'prod_full'
}

export function isBlocked(label: string, ctx: GuardContext): { blocked: boolean; match?: string } {
  if (!isProductionTarget(ctx.environment) || ctx.productionUnlocked) {
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
