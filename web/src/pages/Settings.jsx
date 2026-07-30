import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'

export default function Settings() {
  const { hasRole } = useAuth()
  const canEdit = hasRole(['Owner'])
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get(v1('/settings'))).data?.data ?? {},
  })

  const brainHealth = useQuery({
    queryKey: ['settings-brain-health'],
    queryFn: async () => (await api.get(v1('/settings/brain-health'))).data?.data ?? {},
    staleTime: 30_000,
  })

  const [form, setForm] = useState({})
  useEffect(() => { if (data) setForm(data) }, [data])

  const save = useMutation({
    mutationFn: async () => api.put(v1('/settings'), form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function updateStringList(key, text) {
    update(key, text.split(',').map((s) => s.trim()).filter(Boolean))
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {!canEdit && (
        <div className="qa-card text-sm text-neutral-700">
          Read-only view. Only the <strong>Owner</strong> role can change global settings.
        </div>
      )}

      <Section title="AI Brain">
        <Field label="Session mode">
          <select
            className="qa-input"
            disabled={!canEdit}
            value={form['brain.agent_mode'] || 'template'}
            onChange={(e) => update('brain.agent_mode', e.target.value)}
          >
            <option value="template">Template (deterministic step execution)</option>
            <option value="agent">Agent (vision agent decides each screen)</option>
          </select>
          <p className="mt-1 text-xs text-neutral-500">
            Template runs the session's own pre-authored step list exactly as recorded. Agent instead
            shows the vision model each screen and lets it decide the next click/type/capture action.
          </p>
        </Field>
        <Field label="Vision fallback order (screenshot review)">
          <input
            className="qa-input"
            disabled={!canEdit}
            value={(form['brain.vision_providers'] || []).join(', ')}
            onChange={(e) => updateStringList('brain.vision_providers', e.target.value)}
            placeholder="gemini, openai"
          />
        </Field>
        <Field label="Council providers (text tasks)">
          <input
            className="qa-input"
            disabled={!canEdit}
            value={(form['brain.parallel_providers'] || []).join(', ')}
            onChange={(e) => updateStringList('brain.parallel_providers', e.target.value)}
            placeholder="openai, perplexity"
          />
        </Field>
        <Field label="Synthetic data provider order">
          <input
            className="qa-input"
            disabled={!canEdit}
            value={(form['brain.data_providers'] || []).join(', ')}
            onChange={(e) => updateStringList('brain.data_providers', e.target.value)}
            placeholder="perplexity, openai"
          />
        </Field>
        <Field label="Default arbiter">
          <input
            className="qa-input"
            disabled={!canEdit}
            value={form['brain.default_arbiter'] || ''}
            onChange={(e) => update('brain.default_arbiter', e.target.value)}
            placeholder="gemini"
          />
        </Field>
        <Field label="Timeout (seconds)">
          <input
            type="number"
            className="qa-input"
            disabled={!canEdit}
            value={form['brain.timeout_seconds'] ?? ''}
            onChange={(e) => update('brain.timeout_seconds', Number(e.target.value))}
          />
        </Field>
        <Field label="Max screens per session (agent mode)">
          <input
            type="number"
            className="qa-input"
            disabled={!canEdit}
            value={form['brain.max_screens_per_session'] ?? ''}
            onChange={(e) => update('brain.max_screens_per_session', Number(e.target.value))}
          />
        </Field>

        <div>
          <label className="qa-label">Provider status</label>
          {brainHealth.isLoading && <p className="text-xs text-neutral-500">Checking providers…</p>}
          {brainHealth.isError && <p className="text-xs text-red-700">Could not load provider health.</p>}
          {!brainHealth.isLoading && !brainHealth.isError && (
            <div className="flex flex-wrap gap-2">
              {(brainHealth.data?.providers || []).map((p) => (
                <ProviderBadge key={p.name} provider={p} />
              ))}
              {(brainHealth.data?.providers || []).length === 0 && (
                <span className="text-xs text-neutral-500">No provider data returned.</span>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="flow.aicountly.org Ticket Integration">
        <Field label="Enabled">
          <input type="checkbox" disabled={!canEdit} checked={!!form.flow_webhook_enabled} onChange={(e) => update('flow_webhook_enabled', e.target.checked)} />
          <span className="ml-2 text-xs text-neutral-500">Off by default. QA portal can create tickets but cannot rectify code.</span>
        </Field>
        <Field label="Webhook URL">
          <input className="qa-input" disabled={!canEdit} value={form.flow_webhook_url || ''} onChange={(e) => update('flow_webhook_url', e.target.value)} placeholder="https://flow.aicountly.org/api/tickets" />
        </Field>
      </Section>

      <Section title="Production Unlock (Owner only)">
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
          When enabled, production writes are temporarily allowed for the duration of one run. Use with extreme care.
        </div>
        <Field label="Enabled">
          <input type="checkbox" disabled={!canEdit} checked={!!(form.production_unlock?.enabled)} onChange={(e) => update('production_unlock', { ...(form.production_unlock || {}), enabled: e.target.checked })} />
        </Field>
      </Section>

      {canEdit && (
        <div>
          <button type="button" className="qa-btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="qa-card">
      <h2 className="mb-3 text-sm font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="qa-label">{label}</label>
      <div>{children}</div>
    </div>
  )
}

function ProviderBadge({ provider }) {
  const configured = !!provider.configured
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${configured ? 'bg-aicountly-500' : 'bg-neutral-300'}`} />
      <span className="font-medium text-neutral-900">{provider.name}</span>
      <span className="text-neutral-500">{configured ? 'configured' : 'not configured'}</span>
      {provider.vision_capable && (
        <span className={provider.enabled_for_vision ? 'text-aicountly-700' : 'text-neutral-400'}>
          · vision {provider.enabled_for_vision ? 'enabled' : 'available'}
        </span>
      )}
    </div>
  )
}
