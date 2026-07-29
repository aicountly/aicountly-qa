/**
 * Post-login product-host guard (AUTH_PRODUCT_HOST_MATCH).
 * Fail loudly on wrong product host instead of collecting unrelated evidence.
 */

export type HostGuardInput = {
  currentUrl: string
  baseUrl: string
  allowedDomains?: string | string[] | null
}

export type HostGuardReason =
  | 'match'
  | 'allowlisted'
  | 'no_base_url'
  | 'unreadable_url'
  | 'mismatch'

export type HostGuardResult = {
  ok: boolean
  expectedHost: string
  actualHost: string
  reason: HostGuardReason
  message?: string
}

export function normalizeHost(value: string | null | undefined): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw.replace(/^\/+/, '')}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function parseDomainList(value: string | string[] | null | undefined): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean)
  const raw = String(value).trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.map(String).map((v) => v.trim()).filter(Boolean)
  } catch {
    /* comma-separated */
  }
  return raw.split(',').map((part) => part.trim()).filter(Boolean)
}

function hostMatchesEntry(host: string, entry: string): boolean {
  const trimmed = entry.trim().toLowerCase()
  if (!trimmed) return false
  if (trimmed.startsWith('*.')) {
    const suffix = normalizeHost(trimmed.slice(2))
    return !!suffix && (host === suffix || host.endsWith(`.${suffix}`))
  }
  const normalized = normalizeHost(trimmed)
  return !!normalized && host === normalized
}

export function wrongHostMessage(expectedHost: string, actualHost: string): string {
  return `Wrong product host after login: expected ${expectedHost}, got ${actualHost || '(unknown)'}`
}

export function evaluateHostGuard(input: HostGuardInput): HostGuardResult {
  const expectedHost = normalizeHost(input.baseUrl)
  const actualHost = normalizeHost(input.currentUrl)

  if (!expectedHost) {
    return { ok: true, expectedHost: '', actualHost, reason: 'no_base_url' }
  }
  if (!actualHost) {
    return {
      ok: false,
      expectedHost,
      actualHost: '',
      reason: 'unreadable_url',
      message: wrongHostMessage(expectedHost, input.currentUrl || ''),
    }
  }
  if (actualHost === expectedHost) {
    return { ok: true, expectedHost, actualHost, reason: 'match' }
  }
  if (parseDomainList(input.allowedDomains).some((entry) => hostMatchesEntry(actualHost, entry))) {
    return { ok: true, expectedHost, actualHost, reason: 'allowlisted' }
  }
  return {
    ok: false,
    expectedHost,
    actualHost,
    reason: 'mismatch',
    message: wrongHostMessage(expectedHost, actualHost),
  }
}
