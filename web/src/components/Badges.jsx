import { classNames } from '../lib/format.js'

const statusStyles = {
  queued:                'bg-neutral-100 text-neutral-700',
  claimed:               'bg-amber-100 text-amber-800',
  running:               'bg-blue-100 text-blue-800',
  completed:             'bg-aicountly-100 text-aicountly-800',
  passed:                'bg-aicountly-100 text-aicountly-800',
  failed:                'bg-red-100 text-red-800',
  partial:               'bg-amber-100 text-amber-800',
  skipped:               'bg-neutral-200 text-neutral-700',
  blocked_by_safe_guard: 'bg-red-50 text-red-700 border border-red-200',
  pending:               'bg-neutral-100 text-neutral-700',
  cancelled:             'bg-neutral-200 text-neutral-700',
  draft:                 'bg-neutral-100 text-neutral-700',
  approved:              'bg-aicountly-100 text-aicountly-800',
  rejected:              'bg-red-100 text-red-800',
}

export function StatusBadge({ status }) {
  const k = (status || '').toLowerCase()
  return (
    <span className={classNames('qa-badge', statusStyles[k] || 'bg-neutral-100 text-neutral-700')}>
      {status || '—'}
    </span>
  )
}

const sevStyles = {
  critical: 'bg-red-100 text-red-800',
  high:     'bg-orange-100 text-orange-800',
  medium:   'bg-amber-100 text-amber-800',
  low:      'bg-neutral-100 text-neutral-700',
  warning:  'bg-yellow-100 text-yellow-800',
}

export function SeverityBadge({ severity }) {
  const k = (severity || '').toLowerCase()
  return (
    <span className={classNames('qa-badge', sevStyles[k] || sevStyles.low)}>
      {severity || 'low'}
    </span>
  )
}

const envStyles = {
  sandbox:    'bg-aicountly-50 text-aicountly-700 border border-aicountly-200',
  gh:         'bg-blue-50 text-blue-700 border border-blue-200',
  prod_basic: 'bg-red-50 text-red-700 border border-red-200',
  prod_full:  'bg-red-100 text-red-800 border border-red-300',
}

export function EnvBadge({ environment }) {
  return (
    <span className={classNames('qa-badge', envStyles[environment] || 'bg-neutral-100 text-neutral-700')}>
      {environment || '—'}
    </span>
  )
}
