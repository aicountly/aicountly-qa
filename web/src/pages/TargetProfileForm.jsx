import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import ProductionBanner from '../components/ProductionBanner.jsx'
import { SAAS_PRODUCTS, canonicalizeProductSlug } from '../lib/products.js'
import { useEnvironments } from '../lib/useEnvironments.js'
import { environmentLabel, isObserverOnlyEnvironment } from '../lib/environments.js'

const EXECUTION_MODES = [
  { value: 'full', label: 'Full — data entry plus verification' },
  { value: 'readonly', label: 'Read-only — navigate and verify existing data' },
  { value: 'smoke', label: 'Smoke check — login and key screens only' },
]

const LOGIN_STRATEGIES = [
  { value: 'standard', label: 'Standard — username and password on the login page' },
  { value: 'jump_to', label: 'Jump To — pick the product from the identity dropdown first' },
  { value: 'sso', label: 'SSO / Console session' },
]

const STATUSES = [
  { value: 'active', label: 'Active — selectable for new QA runs' },
  { value: 'paused', label: 'Paused — kept, but not runnable' },
  { value: 'disabled', label: 'Disabled — kept, but not runnable' },
  { value: 'archived', label: 'Archived — hidden from every picker' },
]

const csvToText = (value) => (Array.isArray(value) ? value.join(', ') : String(value ?? ''))
const textToCsv = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** `extra_config` is a free-form JSON object; the form edits it as pretty-printed text. */
function extraConfigToText(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return '' }
}

const DEFAULTS = {
  profile_name: '',
  product_name: 'books',
  environment: 'sandbox',
  base_url: '',
  login_url: '',
  username: '',
  password: '',
  execution_mode: 'full',
  login_strategy: 'standard',
  jump_to: '',
  allowed_domains: '',
  allowed_modules: '',
  ip_restriction: '',
  extra_config: '',
  data_creation_allowed: true,
  production_restriction: true,
  observer_mode: false,
  read_only: false,
  allow_safe_demo: true,
  status: 'active',
}

/** Map a saved profile onto the form field shape, ignoring API-only columns. */
function toFormValues(row) {
  if (!row) return {}
  return {
    profile_name: row.profile_name ?? DEFAULTS.profile_name,
    product_name: canonicalizeProductSlug(row.product_name) || DEFAULTS.product_name,
    environment: row.environment || DEFAULTS.environment,
    base_url: row.base_url ?? DEFAULTS.base_url,
    login_url: row.login_url ?? DEFAULTS.login_url,
    username: row.username ?? DEFAULTS.username,
    execution_mode: row.execution_mode || DEFAULTS.execution_mode,
    login_strategy: row.login_strategy || DEFAULTS.login_strategy,
    jump_to: row.jump_to ?? '',
    allowed_domains: csvToText(row.allowed_domains),
    allowed_modules: csvToText(row.allowed_modules),
    ip_restriction: csvToText(row.ip_restriction),
    extra_config: extraConfigToText(row.extra_config),
    data_creation_allowed: !!row.data_creation_allowed,
    production_restriction: !!row.production_restriction,
    observer_mode: !!row.observer_mode,
    read_only: !!row.read_only,
    allow_safe_demo: !!row.allow_safe_demo,
    status: row.status || DEFAULTS.status,
  }
}

function SafetyToggle({ label, hint, checked, locked, onChange }) {
  return (
    <label className="flex items-start gap-2 text-sm text-neutral-700">
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={locked} onChange={onChange} />
      <span>
        {label}
        {locked && (
          <span className="ml-1 text-[11px] uppercase tracking-wide text-neutral-500">
            (locked by environment)
          </span>
        )}
        {hint && <span className="block text-[11px] text-neutral-500">{hint}</span>}
      </span>
    </label>
  )
}

export default function TargetProfileForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id
  const environments = useEnvironments()

  const { data: existing } = useQuery({
    queryKey: ['target-profile', id],
    queryFn: async () => (await api.get(v1(`/target-profiles/${id}`))).data?.data,
    enabled: isEdit,
  })

  // Edits overlay the saved row, so a slow profile fetch can never overwrite typing
  // and the safety toggles reflect the real environment from the first paint.
  const [edits, setEdits] = useState({})
  const form = useMemo(
    () => ({ ...DEFAULTS, ...toFormValues(existing), ...edits }),
    [existing, edits],
  )

  const observerLocked = isObserverOnlyEnvironment(form.environment)

  // Observer tiers pin the safety flags; the backend enforces the same rule.
  const effective = {
    observer_mode: observerLocked ? true : form.observer_mode,
    read_only: observerLocked ? true : form.read_only,
    production_restriction: observerLocked ? true : form.production_restriction,
    data_creation_allowed: observerLocked ? false : form.data_creation_allowed,
    allow_safe_demo: observerLocked ? false : form.allow_safe_demo,
  }

  // Parsed once so the form can refuse to submit invalid JSON instead of the API
  // silently discarding it.
  const extraConfig = useMemo(() => {
    const text = String(form.extra_config ?? '').trim()
    if (text === '') return { value: null, error: '' }
    try {
      const parsed = JSON.parse(text)
      if (parsed === null) return { value: null, error: '' }
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { value: null, error: 'Extra config must be a JSON object, e.g. {"otp_hint":"authenticator"}.' }
      }
      return { value: parsed, error: '' }
    } catch {
      return { value: null, error: 'Extra config is not valid JSON.' }
    }
  }, [form.extra_config])

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        profile_name: form.profile_name,
        product_name: form.product_name,
        environment: form.environment,
        base_url: form.base_url,
        login_url: form.login_url,
        username: form.username,
        execution_mode: form.execution_mode,
        login_strategy: form.login_strategy,
        jump_to: form.jump_to.trim() || null,
        allowed_domains: textToCsv(form.allowed_domains),
        allowed_modules: textToCsv(form.allowed_modules),
        ip_restriction: textToCsv(form.ip_restriction),
        extra_config: extraConfig.value,
        status: form.status,
        ...effective,
      }

      // The password rides along inline: creating a profile with credentials is a
      // single request, and on edit a blank field leaves the stored secret alone.
      // PUT /target-profiles/{id}/credentials stays available for rotation.
      if (form.password) {
        payload.password = form.password
      }

      const res = isEdit
        ? await api.put(v1(`/target-profiles/${id}`), payload)
        : await api.post(v1('/target-profiles'), payload)

      return isEdit ? id : res.data?.data?.id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['target-profiles'] })
      qc.invalidateQueries({ queryKey: ['target-profile', id] })
      nav('/target-profiles')
    },
  })

  const onChange = (k) => (e) =>
    setEdits((prev) => ({ ...prev, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const envDescription = environments.find((e) => e.value === form.environment)?.description || ''

  return (
    <div className="max-w-3xl space-y-4">
      <ProductionBanner environment={form.environment} profileName={form.profile_name} />

      {isEdit && existing && existing.has_credentials === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Credentials not configured</p>
          <p className="mt-1">Enter the target app password below and save. The QA worker cannot log in until credentials are set.</p>
        </div>
      )}

      <form className="qa-card space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <div>
          <h2 className="text-base font-semibold text-neutral-900">{isEdit ? 'Edit' : 'New'} Target App Profile</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Defines which app QA may sign into, what it is allowed to do there, and how tightly the
            safety guard is applied.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="qa-label">Profile name</label>
            <input className="qa-input" required value={form.profile_name} onChange={onChange('profile_name')} />
          </div>
          <div>
            <label className="qa-label">Product</label>
            <select className="qa-input" value={form.product_name} onChange={onChange('product_name')}>
              {SAAS_PRODUCTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div>
            <label className="qa-label">Environment</label>
            <select className="qa-input" required value={form.environment} onChange={onChange('environment')}>
              {environments.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
            {envDescription && <p className="mt-1 text-[11px] text-neutral-500">{envDescription}</p>}
          </div>
          <div>
            <label className="qa-label">Status</label>
            <select className="qa-input" value={form.status} onChange={onChange('status')}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {form.status !== 'active' && (
              <p className="mt-1 text-[11px] text-amber-800">
                Only active profiles can start a QA run.
              </p>
            )}
          </div>

          <div>
            <label className="qa-label">Execution mode</label>
            <select className="qa-input" value={form.execution_mode} onChange={onChange('execution_mode')}>
              {EXECUTION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="qa-label">Login strategy</label>
            <select className="qa-input" value={form.login_strategy} onChange={onChange('login_strategy')}>
              {LOGIN_STRATEGIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="qa-label">Base URL</label>
            <input className="qa-input" required value={form.base_url} onChange={onChange('base_url')} placeholder="https://sandbox.aicountly.com" />
          </div>
          <div className="sm:col-span-2">
            <label className="qa-label">Login URL</label>
            <input className="qa-input" required value={form.login_url} onChange={onChange('login_url')} placeholder="https://sandbox.aicountly.com/login" />
          </div>

          <div>
            <label className="qa-label">Username</label>
            <input className="qa-input" required value={form.username} onChange={onChange('username')} />
          </div>
          <div>
            <label className="qa-label">{isEdit ? 'Password (leave blank to keep current)' : 'Password'}</label>
            <input type="password" className="qa-input" value={form.password} onChange={onChange('password')} autoComplete="new-password" />
            <p className="mt-1 text-[11px] text-neutral-500">Stored encrypted with AES-256-GCM; never persisted in plaintext.</p>
          </div>

          <div className="sm:col-span-2">
            <label className="qa-label">Jump-To override</label>
            <input className="qa-input" value={form.jump_to} onChange={onChange('jump_to')} placeholder="Leave blank to use the product default" />
            <p className="mt-1 text-[11px] text-neutral-500">
              Exact option text for the identity “Jump To” dropdown when it differs from the product name.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="qa-label">Allowed domains (comma-separated)</label>
            <input className="qa-input" value={form.allowed_domains} onChange={onChange('allowed_domains')} placeholder="sandbox.aicountly.com" />
          </div>
          <div className="sm:col-span-2">
            <label className="qa-label">Allowed modules (comma-separated)</label>
            <input className="qa-input" value={form.allowed_modules} onChange={onChange('allowed_modules')} placeholder="Masters, Vouchers, Reports" />
          </div>
          <div className="sm:col-span-2">
            <label className="qa-label">IP restriction (comma-separated CIDRs)</label>
            <input className="qa-input" value={form.ip_restriction} onChange={onChange('ip_restriction')} placeholder="leave blank to allow any" />
          </div>

          <div className="sm:col-span-2">
            <label className="qa-label">Extra config (JSON)</label>
            <textarea
              className="qa-input min-h-[96px] font-mono text-xs"
              value={form.extra_config}
              onChange={onChange('extra_config')}
              placeholder={'{\n  "otp_hint": "authenticator"\n}'}
            />
            {extraConfig.error ? (
              <p className="mt-1 text-[11px] text-red-700">{extraConfig.error}</p>
            ) : (
              <p className="mt-1 text-[11px] text-neutral-500">
                Optional per-target overrides passed through to the worker. Leave blank for none.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="text-sm font-semibold text-neutral-900">Safety guard</div>
          {observerLocked && (
            <p className="text-xs text-amber-900">
              {environmentLabel(form.environment)} is observer-only. Read-only and production
              restriction are forced on, and data creation and safe demo are forced off, so QA can
              verify live data without ever changing it.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SafetyToggle
              label="Data creation allowed"
              hint="Lets sessions create deterministic test records for data-correctness checks."
              checked={effective.data_creation_allowed}
              locked={observerLocked}
              onChange={onChange('data_creation_allowed')}
            />
            <SafetyToggle
              label="Allow safe demo"
              hint="Required for synthetic file upload/download round-trips."
              checked={effective.allow_safe_demo}
              locked={observerLocked}
              onChange={onChange('allow_safe_demo')}
            />
            <SafetyToggle
              label="Production restriction"
              hint="Blocks destructive actions outside the allowed modules."
              checked={effective.production_restriction}
              locked={observerLocked}
              onChange={onChange('production_restriction')}
            />
            <SafetyToggle
              label="Observer mode"
              hint="Navigate and verify only; never submit a form."
              checked={effective.observer_mode}
              locked={observerLocked}
              onChange={onChange('observer_mode')}
            />
            <SafetyToggle
              label="Read only"
              hint="Hard block on every write, even when a session asks for one."
              checked={effective.read_only}
              locked={observerLocked}
              onChange={onChange('read_only')}
            />
          </div>
        </div>

        {save.isError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {save.error?.response?.data?.error
              || Object.values(save.error?.response?.data?.messages || {}).join(' ')
              || save.error?.message
              || 'Save failed.'}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="qa-btn-secondary" onClick={() => nav('/target-profiles')}>Cancel</button>
          <button type="submit" className="qa-btn-primary" disabled={save.isPending || !!extraConfig.error}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  )
}
