export function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function fmtRelative(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
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
