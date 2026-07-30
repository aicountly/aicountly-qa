import type { Page } from 'playwright'
import { BrainUnavailableError, invokeBrain } from '../brain/ensemble.js'
import type { Run, Session, TargetProfile } from '../types.js'
import { detectGaps, type CompetitorBenchmark, type FeatureGap, type InventoryEntry } from './featureGapEngine.js'
import { fallbackCompetitorCatalogs } from './fallbackCompetitorCatalogs.js'

/**
 * Optional brain pass over the heuristic feature gaps. Asks the council to:
 *   - prune false positives
 *   - rank by expected impact
 *   - add concrete competitor references with source URLs (Perplexity)
 *
 * If the brain is unconfigured, the input gaps are returned unchanged.
 */
export async function enrichGaps(productName: string, environment: string, gaps: FeatureGap[]): Promise<FeatureGap[]> {
  if (gaps.length === 0) return gaps

  const sys = `You are an AICOUNTLY product gap analyst. Given a list of candidate
missing features for product "${productName}", refine: drop probable false
positives, sharpen recommendations, and rank by expected user impact. Output
JSON in the same schema you receive.`

  const usr = JSON.stringify({ product: productName, environment, gaps }, null, 2)

  try {
    const r = await invokeBrain('feature_gap', sys, usr, {
      product: productName,
      environment,
      expect_json: true,
    })
    const final = r.final as { gaps?: FeatureGap[]; feature_gaps?: FeatureGap[] } | FeatureGap[] | null
    // Never replace heuristics with an empty AI payload (common when brain is deterministic / unconfigured).
    if (Array.isArray(final)) {
      return final.length > 0 ? final : gaps
    }
    if (final && Array.isArray(final.gaps) && final.gaps.length > 0) return final.gaps
    if (final && Array.isArray(final.feature_gaps) && final.feature_gaps.length > 0) return final.feature_gaps
    return gaps
  } catch (e) {
    if (e instanceof BrainUnavailableError) throw e
    console.warn('[aicountly-qa-worker] competitor enrichment skipped:', (e as Error).message)
    return gaps
  }
}

/**
 * QA has no DOM-inventory scanner (smoke's scanner/uiInventory.ts), so the
 * heuristic input is built from whatever is on screen right now: visible body
 * text lines (candidate menu/feature labels) plus the keys of any tables
 * already captured this session. Good enough for fuzzy token matching against
 * the competitor catalogs — precision is expected to be low without a real
 * inventory walk, which is why the AI refinement pass (enrichGaps) runs after.
 */
async function buildHeuristicInventory(
  page: Page,
  tables: Record<string, Array<Record<string, string>>>,
): Promise<InventoryEntry[]> {
  const url = page.url()
  let bodyText = ''
  try {
    bodyText = await page.locator('body').innerText({ timeout: 5_000 })
  } catch {
    bodyText = ''
  }

  const lines = bodyText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 1 && line.length <= 80)
  const textEntries: InventoryEntry[] = [...new Set(lines)].slice(0, 400).map((label) => ({
    kind: 'menu',
    label,
    selector: '',
    url,
    payload: {},
  }))

  const tableEntries: InventoryEntry[] = Object.keys(tables).map((key) => ({
    kind: 'table',
    label: key.replace(/_/g, ' '),
    selector: '',
    url,
    payload: {},
  }))

  return [...textEntries, ...tableEntries]
}

export interface FeatureGapReviewInput {
  page: Page
  session: Pick<Session, 'name' | 'module' | 'sub_module'>
  run: Pick<Run, 'product_name' | 'environment'>
  profile: Pick<TargetProfile, 'product_name' | 'environment'>
  tables: Record<string, Array<Record<string, string>>>
  moduleName?: string
}

/**
 * Runs the heuristic feature-gap engine against the current screen, then asks
 * the AI council to refine the result. Never throws for "nothing to review"
 * cases (no catalog / no candidate gaps) — only a genuine BrainUnavailableError
 * from the refinement call propagates, since that mirrors smoke's enrichGaps
 * contract. Callers wiring this into a session should decide whether that
 * should be caught and swallowed (feature-gap review is enrichment, not a
 * pass/fail QA rule).
 */
export async function runFeatureGapReview(input: FeatureGapReviewInput): Promise<FeatureGap[]> {
  const productName = input.profile.product_name || input.run.product_name
  if (!productName) return []

  const benchmarks: CompetitorBenchmark[] = fallbackCompetitorCatalogs(productName)
  if (benchmarks.length === 0) return []

  const environment = String(input.profile.environment || input.run.environment || 'sandbox')
  const inventory = await buildHeuristicInventory(input.page, input.tables)
  const menuPath = input.moduleName || input.session.module || input.session.sub_module || undefined

  const heuristicGaps = detectGaps(productName, inventory, benchmarks, {
    sessionName: input.session.name,
    menuPath: menuPath || undefined,
    screensChecked: [input.page.url()],
  })
  if (heuristicGaps.length === 0) return []

  return enrichGaps(productName, environment, heuristicGaps)
}
