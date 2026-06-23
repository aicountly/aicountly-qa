import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import ProductionBanner from '../components/ProductionBanner.jsx'
import { SAAS_PRODUCTS } from '../lib/products.js'
const envs = [
  { value: 'sandbox',    label: 'Sandbox' },
  { value: 'gh',         label: 'GH / Staging' },
  { value: 'prod_basic', label: 'Production (Basic Check Only)' },
  { value: 'prod_full',  label: 'Production (Full — locked by default)' },
]

export default function TargetProfileForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [form, setForm] = useState({
    profile_name: '',
    product_name: 'books',
    environment: 'sandbox',
    base_url: '',
    login_url: '',
    username: '',
    password: '',
    allowed_domains: '',
    allowed_modules: '',
    ip_restriction: '',
    execution_mode: 'full',
    data_creation_allowed: true,
    production_restriction: true,
    status: 'active',
  })

  const { data: existing } = useQuery({
    queryKey: ['target-profile', id],
    queryFn: async () => (await api.get(v1(`/target-profiles/${id}`))).data?.data,
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existing) return
    setForm((f) => ({
      ...f,
      ...existing,
      allowed_domains: Array.isArray(existing.allowed_domains) ? existing.allowed_domains.join(',') : (existing.allowed_domains || ''),
      allowed_modules: Array.isArray(existing.allowed_modules) ? existing.allowed_modules.join(',') : (existing.allowed_modules || ''),
      ip_restriction:  Array.isArray(existing.ip_restriction)  ? existing.ip_restriction.join(',')  : (existing.ip_restriction  || ''),
      password: '',
    }))
  }, [existing])

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        allowed_domains: form.allowed_domains ? form.allowed_domains.split(',').map((s) => s.trim()).filter(Boolean) : [],
        allowed_modules: form.allowed_modules ? form.allowed_modules.split(',').map((s) => s.trim()).filter(Boolean) : [],
        ip_restriction:  form.ip_restriction  ? form.ip_restriction.split(',').map((s) => s.trim()).filter(Boolean)  : [],
      }
      delete payload.password
      delete payload.has_credentials

      const res = isEdit
        ? await api.put(v1(`/target-profiles/${id}`), payload)
        : await api.post(v1('/target-profiles'), payload)

      const newId = isEdit ? id : res.data?.data?.id
      if (form.password) {
        await api.put(v1(`/target-profiles/${newId}/credentials`), { password: form.password })
      }
      return newId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['target-profiles'] })
      nav('/target-profiles')
    },
  })

  const onChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div className="space-y-4">
        <ProductionBanner environment={form.environment} profileName={form.profile_name} />

      {isEdit && existing && existing.has_credentials === false && (
        <div className="max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Credentials not configured</p>
          <p className="mt-1">Enter the target app password below and save. The QA worker cannot log in until credentials are set.</p>
        </div>
      )}

      <form
        className="qa-card max-w-3xl space-y-4"
        onSubmit={(e) => { e.preventDefault(); save.mutate() }}
      >
        <h2 className="text-base font-semibold text-neutral-900">{isEdit ? 'Edit' : 'New'} Target App Profile</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="qa-label">Profile name</label><input className="qa-input" required value={form.profile_name} onChange={onChange('profile_name')} /></div>
          <div>
            <label className="qa-label">Product</label>
            <select className="qa-input" value={form.product_name} onChange={onChange('product_name')}>
              {SAAS_PRODUCTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="qa-label">Environment</label>
            <select className="qa-input" value={form.environment} onChange={onChange('environment')}>
              {envs.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="qa-label">Execution mode</label>
            <select className="qa-input" value={form.execution_mode} onChange={onChange('execution_mode')}>
              <option value="full">Full</option>
              <option value="readonly">Read-only</option>
              <option value="smoke">Smoke check</option>
            </select>
          </div>
          <div className="sm:col-span-2"><label className="qa-label">Base URL</label><input className="qa-input" required value={form.base_url} onChange={onChange('base_url')} placeholder="https://sandbox.aicountly.com" /></div>
          <div className="sm:col-span-2"><label className="qa-label">Login URL</label><input className="qa-input" required value={form.login_url} onChange={onChange('login_url')} placeholder="https://sandbox.aicountly.com/login" /></div>

          <div><label className="qa-label">Username</label><input className="qa-input" required value={form.username} onChange={onChange('username')} /></div>
          <div>
            <label className="qa-label">{isEdit ? 'Password (leave blank to keep current)' : 'Password'}</label>
            <input type="password" className="qa-input" value={form.password} onChange={onChange('password')} autoComplete="new-password" />
            <p className="mt-1 text-[11px] text-neutral-500">Stored encrypted with AES-256-GCM; never persisted in plaintext.</p>
          </div>

          <div className="sm:col-span-2"><label className="qa-label">Allowed domains (comma-separated)</label><input className="qa-input" value={form.allowed_domains} onChange={onChange('allowed_domains')} placeholder="sandbox.aicountly.com" /></div>
          <div className="sm:col-span-2"><label className="qa-label">Allowed modules (comma-separated)</label><input className="qa-input" value={form.allowed_modules} onChange={onChange('allowed_modules')} placeholder="Masters,Vouchers,Reports" /></div>
          <div className="sm:col-span-2"><label className="qa-label">IP restriction (comma-separated CIDRs)</label><input className="qa-input" value={form.ip_restriction} onChange={onChange('ip_restriction')} placeholder="leave blank to allow any" /></div>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={form.data_creation_allowed} onChange={onChange('data_creation_allowed')} />
            data_creation_allowed
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={form.production_restriction} onChange={onChange('production_restriction')} />
            production_restriction
          </label>
        </div>

        {save.isError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {save.error?.response?.data?.error || save.error?.message || 'Save failed.'}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="qa-btn-secondary" onClick={() => nav('/target-profiles')}>Cancel</button>
          <button type="submit" className="qa-btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  )
}
