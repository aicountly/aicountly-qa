/**
 * Environment safety tiers, mirroring server-php/app/Config/Environments.php.
 *
 * Never test a tier with `env.startsWith('production')` — that would sweep
 * production_full_access into the observer-only rules it deliberately opts out of.
 */

export type Environment =
  | 'sandbox'
  | 'gh_staging'
  | 'production_readonly'
  | 'production_restricted'
  | 'production_full_access'

export const ENVIRONMENTS: Environment[] = [
  'sandbox',
  'gh_staging',
  'production_readonly',
  'production_restricted',
  'production_full_access',
]

/** Legacy QA values that may still arrive from an older API or an unmigrated row. */
const LEGACY_MAP: Record<string, Environment> = {
  gh: 'gh_staging',
  prod_basic: 'production_readonly',
  prod_full: 'production_full_access',
}

/** Reverse of LEGACY_MAP, for reading template keys authored before the rename. */
export const LEGACY_ALIASES: Partial<Record<Environment, string[]>> = {
  gh_staging: ['gh'],
  production_readonly: ['prod_basic'],
  production_full_access: ['prod_full'],
}

const PRODUCTION: Environment[] = [
  'production_readonly',
  'production_restricted',
  'production_full_access',
]

const OBSERVER_ONLY: Environment[] = ['production_readonly', 'production_restricted']

const FULL_ACCESS: Environment[] = ['sandbox', 'gh_staging', 'production_full_access']

export function normalizeEnvironment(value: string | null | undefined): Environment {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return 'sandbox'
  const mapped = LEGACY_MAP[raw]
  if (mapped) return mapped
  return (ENVIRONMENTS as string[]).includes(raw) ? (raw as Environment) : 'sandbox'
}

/**
 * Keys to try, in order, when reading a template's steps_by_env block.
 * Observer tiers fall back to the read-only script rather than the full one.
 */
export function templateKeys(value: string | null | undefined): string[] {
  const canonical = normalizeEnvironment(value)
  const keys = [canonical, ...(LEGACY_ALIASES[canonical] ?? [])]

  if (isObserverOnly(canonical)) {
    keys.push('production_readonly', 'prod_basic')
  } else if (isProduction(canonical)) {
    keys.push('prod_full')
  }

  return [...new Set(keys)]
}

export function isProduction(value: string | null | undefined): boolean {
  return PRODUCTION.includes(normalizeEnvironment(value))
}

/** Live tiers that may never write, upload, or download a mutated artifact. */
export function isObserverOnly(value: string | null | undefined): boolean {
  return OBSERVER_ONLY.includes(normalizeEnvironment(value))
}

export function allowsFullAccess(value: string | null | undefined): boolean {
  return FULL_ACCESS.includes(normalizeEnvironment(value))
}

export function allowsDataCreation(value: string | null | undefined): boolean {
  return !isObserverOnly(value)
}

export function allowsFileActions(value: string | null | undefined): boolean {
  return !isObserverOnly(value)
}

export function environmentLabel(value: string | null | undefined): string {
  return ({
    sandbox: 'Sandbox',
    gh_staging: 'GH Staging',
    production_readonly: 'Production (read only)',
    production_restricted: 'Production (restricted)',
    production_full_access: 'Production (full access)',
  } as Record<Environment, string>)[normalizeEnvironment(value)]
}
