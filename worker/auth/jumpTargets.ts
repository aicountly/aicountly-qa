/**
 * Product-scoped Jump To selection for my.aicountly.com.
 * Candidate order wins over dropdown order. No global Books fallback for non-Books profiles.
 */

export type JumpOption = { value: string; label: string }

export type JumpPlan = {
  product: string
  preferred: string[]
  booksFamily: boolean
  warnings: string[]
}

export type JumpPick = {
  option: JumpOption
  matchedPreference: string | null
  source: 'preferred' | 'first_option' | 'runtime_contract'
}

const PRODUCT_JUMP_TARGETS: Array<[RegExp, string[]]> = [
  [/^(hrms|gh[-_]?hrms)$/i, ['HRMS']],
  [/^(ourpeople|our[-_ ]people|ess)$/i, ['Our People', 'OurPeople', 'HRMS']],
  [/^(books|smart[-_ ]?books|gh[-_]?books|accounting)$/i, ['Smart Books', 'Books']],
  [/^(auditor|audit)$/i, ['Auditor']],
  [/^(fr|financial[-_ ]?reporting)$/i, ['Financial Reporting', 'FR']],
  [/^secretarial$/i, ['Secretarial']],
  [/^vault$/i, ['Vault']],
  [/^contacts?$/i, ['Contacts']],
  [/^my[-_ ]?account$/i, ['My Account']],
  [/^calendar$/i, ['Calendar']],
  [/^(docs?|documents?)$/i, ['Docs', 'Documents']],
  [/^chat$/i, ['Chat']],
  [/^buddy$/i, ['Buddy']],
  [/^erp([-_ ]?(beta|1|3)(\.0)?)?$/i, ['ERP', 'ERP (Beta)', 'ERP 3.0', 'ERP 1.0']],
]

const BOOKS_FAMILY_PRODUCT = /^(books|smart[-_ ]?books|gh[-_]?books|accounting|erp([-_ ]?(beta|1|3)(\.0)?)?)$/i
const BOOKS_FAMILY_FALLBACKS = ['Smart Books', 'Books', 'ERP', 'ERP (Beta)', 'ERP 3.0', 'ERP 1.0']
const PLACEHOLDER_OPTION = /^(select|choose|jump|--|\s*$)/i

export function productJumpTargets(product: string): string[] {
  const key = (product || '').trim()
  if (!key) return []
  for (const [pattern, targets] of PRODUCT_JUMP_TARGETS) {
    if (pattern.test(key)) return targets.slice()
  }
  return []
}

export function isBooksFamilyProduct(product: string): boolean {
  return BOOKS_FAMILY_PRODUCT.test((product || '').trim())
}

function envKeyFor(product: string): string {
  return `QA_JUMP_TO_${product.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

/**
 * Builds ordered Jump To preferences.
 * runtimeCandidates (from API runtime_contract.login.jump_to_candidates) win first.
 * QA_JUMP_TO_<PRODUCT> overrides next. Global QA_JUMP_TO is demoted / warned.
 */
export function buildJumpPlan(
  product: string,
  runtimeCandidates: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): JumpPlan {
  const name = (product || '').trim()
  const warnings: string[] = []
  const preferred: string[] = []

  for (const c of runtimeCandidates) {
    if (typeof c === 'string' && c.trim()) preferred.push(c.trim())
  }

  const scoped = name ? (env[envKeyFor(name)] || '').trim() : ''
  if (scoped) preferred.push(scoped)

  const mapped = productJumpTargets(name)
  preferred.push(...mapped)
  if (name) preferred.push(name)

  const global = (env.QA_JUMP_TO || '').trim()
  if (global) {
    if (mapped.length > 0 && !mapped.some((target) => matchesJump(target, target, global))) {
      warnings.push(
        `QA_JUMP_TO="${global}" does not match product "${name}" (expected ${mapped.join(' / ')}); `
        + 'using product mapping first. Prefer QA_JUMP_TO_<PRODUCT> on multi-product workers.',
      )
    }
    preferred.push(global)
  }

  const booksFamily = isBooksFamilyProduct(name)
  if (booksFamily) preferred.push(...BOOKS_FAMILY_FALLBACKS)

  return { product: name, preferred: dedupe(preferred), booksFamily, warnings }
}

export function filterUsableJumpOptions(options: JumpOption[]): JumpOption[] {
  return options.filter((o) => {
    const value = (o.value || '').trim()
    const label = (o.label || '').trim()
    if (!value && !label) return false
    if (PLACEHOLDER_OPTION.test(label)) return false
    if (/^(select|choose|jump|--)$/i.test(value)) return false
    return true
  })
}

export function pickJumpTarget(options: JumpOption[], plan: JumpPlan): JumpPick | null {
  const usable = filterUsableJumpOptions(options)
  if (usable.length === 0) return null

  for (const preference of plan.preferred) {
    const option = usable.find((o) => matchesJump(o.label, o.value, preference))
    if (option) {
      return {
        option,
        matchedPreference: preference,
        source: 'preferred',
      }
    }
  }

  return { option: usable[0], matchedPreference: null, source: 'first_option' }
}

export function matchesJump(label: string, value: string, preferred: string): boolean {
  const needle = normalize(preferred)
  if (!needle) return false
  const hay = normalize(`${label} ${value}`)
  if (needle.length <= 2) return hay.split(/[^a-z0-9]+/).includes(needle)
  if (hay.includes(needle)) return true
  return compact(hay).includes(compact(needle))
}

function normalize(value: string): string {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]/g, '')
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = normalize(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}
