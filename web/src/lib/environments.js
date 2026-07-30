/**
 * Target environment safety tiers.
 *
 * All three `production_*` tiers are live targets (production banner + red badge).
 * Only read-only and restricted are observer-only: production_full_access may
 * create data and exercise file upload/download round-trips.
 */
export const ENVIRONMENTS = [
  {
    value: 'sandbox',
    label: 'Sandbox',
    shortLabel: 'Sandbox',
    description: 'Disposable QA data. Every check is allowed, including synthetic file uploads.',
    is_production: false,
    observer_only: false,
    allows_data_creation: true,
    allows_file_actions: true,
  },
  {
    value: 'gh_staging',
    label: 'GH / Staging',
    shortLabel: 'GH / Staging',
    description: 'Shared staging build. Same permissions as sandbox.',
    is_production: false,
    observer_only: false,
    allows_data_creation: true,
    allows_file_actions: true,
  },
  {
    value: 'production_readonly',
    label: 'Production Read-Only',
    shortLabel: 'Production R/O',
    description: 'Live data, observer only: login plus read-only navigation and report loads.',
    is_production: true,
    observer_only: true,
    allows_data_creation: false,
    allows_file_actions: false,
  },
  {
    value: 'production_restricted',
    label: 'Production Restricted',
    shortLabel: 'Production Restricted',
    description: 'Live data, observer only with tighter module scoping. No writes, no file actions.',
    is_production: true,
    observer_only: true,
    allows_data_creation: false,
    allows_file_actions: false,
  },
  {
    value: 'production_full_access',
    label: 'Production Full Access',
    shortLabel: 'Production Full',
    description: 'Live data the owner controls. Same permissions as sandbox, still flagged as production.',
    is_production: true,
    observer_only: false,
    allows_data_creation: true,
    allows_file_actions: true,
  },
]

export const ENVIRONMENT_VALUES = ENVIRONMENTS.map((e) => e.value)

/** For FilterBar / select inputs. */
export const ENVIRONMENT_FILTER_OPTIONS = ENVIRONMENTS.map((e) => ({
  value: e.value,
  label: e.label,
}))

/** Values written by earlier releases; still present in old runs and profiles. */
const LEGACY_ENVIRONMENT_SLUGS = {
  gh: 'gh_staging',
  staging: 'gh_staging',
  prod_basic: 'production_readonly',
  prod_full: 'production_full_access',
  prod_readonly: 'production_readonly',
}

const LEGACY_ENVIRONMENT_LABELS = {
  gh: 'GH / Staging (legacy)',
  staging: 'GH / Staging (legacy)',
  prod_basic: 'Production Read-Only (legacy)',
  prod_full: 'Production Full Access (legacy)',
  prod_readonly: 'Production Read-Only (legacy)',
}

function normalize(environment) {
  return String(environment ?? '').trim().toLowerCase()
}

/** Map a legacy slug onto its current tier; unknown values pass through. */
export function canonicalizeEnvironment(environment) {
  const key = normalize(environment)
  if (!key) return ''
  return LEGACY_ENVIRONMENT_SLUGS[key] || key
}

export function environmentTier(environment) {
  const canonical = canonicalizeEnvironment(environment)
  return ENVIRONMENTS.find((e) => e.value === canonical) || null
}

export function environmentLabel(environment) {
  const key = normalize(environment)
  if (!key) return '—'
  if (LEGACY_ENVIRONMENT_LABELS[key]) return LEGACY_ENVIRONMENT_LABELS[key]
  return environmentTier(key)?.label || environment
}

export function environmentShortLabel(environment) {
  return environmentTier(environment)?.shortLabel || environmentLabel(environment)
}

/** Live target: show the production banner and the red badge. */
export function isProductionEnvironment(environment) {
  return environmentTier(environment)?.is_production === true
}

/** Live target where destructive actions are always disabled. */
export function isObserverOnlyEnvironment(environment) {
  return environmentTier(environment)?.observer_only === true
}

export function allowsDataCreation(environment) {
  const tier = environmentTier(environment)
  return tier ? tier.allows_data_creation === true : true
}

/** Synthetic file upload / download round-trips need a writable target. */
export function allowsFileActions(environment) {
  const tier = environmentTier(environment)
  return tier ? tier.allows_file_actions === true : true
}

/**
 * `GET /v1/environments` returns `{default, environments[], legacy_map}`; older
 * builds returned a bare array. Accept either so the portal keeps working
 * across a partial deploy.
 */
function environmentRowsFrom(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.environments)) return payload.environments
  return []
}

/**
 * Merge `GET /v1/environments` rows over the local constants so a newly
 * deployed tier shows up without a frontend release. Falls back to the local
 * list when the endpoint is missing or returns nothing usable.
 */
export function mergeEnvironmentRows(payload) {
  const rows = environmentRowsFrom(payload)
  if (rows.length === 0) return ENVIRONMENTS

  const merged = rows
    .filter((row) => row && String(row.value ?? '').trim() !== '')
    .map((row) => {
      const value = String(row.value).trim()
      const local = ENVIRONMENTS.find((e) => e.value === value)
      return {
        value,
        // Local labels win for known tiers so wording stays consistent across the portal.
        label: local?.label || row.label || value,
        shortLabel: local?.shortLabel || row.label || value,
        description: row.description || local?.description || '',
        is_production: row.is_production ?? local?.is_production ?? false,
        observer_only: row.observer_only ?? local?.observer_only ?? false,
        allows_data_creation: row.allows_data_creation ?? local?.allows_data_creation ?? true,
        allows_file_actions: row.allows_file_actions ?? local?.allows_file_actions ?? true,
      }
    })

  return merged.length > 0 ? merged : ENVIRONMENTS
}
