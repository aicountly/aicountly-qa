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

  const [form, setForm] = useState({})
  useEffect(() => { if (data) setForm(data) }, [data])

  const save = useMutation({
    mutationFn: async () => api.put(v1('/settings'), form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {!canEdit && (
        <div className="qa-card text-sm text-neutral-700">
          Read-only view. Only the <strong>Owner</strong> role can change global settings.
        </div>
      )}

      <Section title="LLM Provider (Session Planner)">
        <Field label="Enabled">
          <input type="checkbox" disabled={!canEdit} checked={!!form.llm_enabled} onChange={(e) => update('llm_enabled', e.target.checked)} />
          <span className="ml-2 text-xs text-neutral-500">When off, plans are generated purely from deterministic templates.</span>
        </Field>
        <Field label="Provider">
          <input className="qa-input" disabled={!canEdit} value={form.llm_provider || ''} onChange={(e) => update('llm_provider', e.target.value)} placeholder="openai | anthropic | gemini" />
        </Field>
        <Field label="Model">
          <input className="qa-input" disabled={!canEdit} value={form.llm_model || ''} onChange={(e) => update('llm_model', e.target.value)} placeholder="e.g. gpt-4o-mini" />
        </Field>
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
