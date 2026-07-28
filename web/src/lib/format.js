/** Display timezone for all QA portal timestamps. */
export const DISPLAY_TIMEZONE = 'Asia/Kolkata'

/**
 * Parse API / DB datetimes. Naive values (no Z/offset) are treated as UTC
 * because the QA API appTimezone is UTC.
 */
export function parseApiDate(iso) {
  if (!iso) return null
  if (iso instanceof Date) return iso

  const s = String(iso).trim()
  if (!s) return null

  // Already has explicit timezone / offset
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss" → UTC
  const normalized = s.includes('T') ? s : s.replace(' ', 'T')
  const d = new Date(`${normalized}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = parseApiDate(iso)
    if (!d) return String(iso)
    return d.toLocaleString('en-IN', {
      timeZone: DISPLAY_TIMEZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return String(iso)
  }
}

export function fmtRelative(iso) {
  if (!iso) return '—'
  const d = parseApiDate(iso)
  if (!d) return '—'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

export const envLabel = {
  sandbox: 'Sandbox',
  gh: 'GH / Staging',
  prod_basic: 'Production (Basic)',
  prod_full: 'Production (Full)',
}

export function isProd(env) {
  return env === 'prod_basic' || env === 'prod_full'
}

export function classNames(...xs) {
  return xs.filter(Boolean).join(' ')
}
