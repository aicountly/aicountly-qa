import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { EnvBadge } from '../components/Badges.jsx'
import ProductionBanner from '../components/ProductionBanner.jsx'
import { envLabel } from '../lib/format.js'

const samplePrompts = [
  'Login to Books sandbox. Verify dashboard loads, menus open, and report pages render without console errors. Do not create dummy data. Run as smoke check.',
  'Full functional QA on Books sandbox. Create deterministic ledgers, items, vouchers; verify GST, Trial Balance, P&L, Balance Sheet against expected results.',
  'Focus on GST. Create sales and purchase vouchers; validate GSTR-1, GSTR-3B, HSN summary against expected output/input GST.',
  'Production basic check. Login only, confirm dashboard and report pages load, capture console + network errors. No dummy data.',
]

export default function NewQaRun() {
  const nav = useNavigate()
  const [profileId, setProfileId] = useState('')
  const [promptText, setPrompt] = useState('')
  const [kind, setKind] = useState('template')

  const profiles = useQuery({
    queryKey: ['target-profiles'],
    queryFn: async () => (await api.get(v1('/target-profiles'))).data?.data ?? [],
  })

  const selected = (profiles.data || []).find((p) => String(p.id) === String(profileId))

  const submit = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(v1('/master-prompts'), {
        target_profile_id: Number(profileId),
        prompt_text: promptText,
        prompt_kind: kind,
      })
      return data?.data
    },
    onSuccess: (d) => {
      if (d?.qa_run_id) nav(`/session-plans?qa_run_id=${encodeURIComponent(d.qa_run_id)}`)
    },
  })

  return (
    <div className="space-y-4">
      <ProductionBanner environment={selected?.environment} profileName={selected?.profile_name} />

      <form
        className="qa-card max-w-3xl space-y-4"
        onSubmit={(e) => { e.preventDefault(); submit.mutate() }}
      >
        <h2 className="text-base font-semibold text-neutral-900">New QA Run</h2>
        <p className="text-sm text-neutral-600">
          The QA bot will analyse the selected target app and split the master prompt into menu-wise sessions for you to review before running.
        </p>

        <div>
          <label className="qa-label">Target App Profile</label>
          <select className="qa-input" required value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Select a profile…</option>
            {(profiles.data || []).map((p) => (
              <option key={p.id} value={p.id}>{p.product_name} · {p.profile_name} ({envLabel[p.environment] || p.environment})</option>
            ))}
          </select>
          {selected && (
            <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
              <EnvBadge environment={selected.environment} />
              <span>{selected.base_url}</span>
            </div>
          )}
        </div>

        <div>
          <label className="qa-label">Master Prompt</label>
          <textarea
            required
            className="qa-input min-h-[120px]"
            value={promptText}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want tested. Reference modules, menus or focus areas."
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {samplePrompts.map((s, i) => (
              <button key={i} type="button" className="qa-btn-secondary text-xs" onClick={() => setPrompt(s)}>
                Use sample #{i + 1}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="qa-label">Generation Mode</label>
          <select className="qa-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="template">Template (deterministic, recommended)</option>
            <option value="hybrid">Hybrid (template + LLM hook when enabled)</option>
            <option value="llm">LLM only (requires provider configured in Settings)</option>
          </select>
        </div>

        {submit.isError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {submit.error?.response?.data?.error || submit.error?.message || 'Failed to start QA run.'}
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" className="qa-btn-primary" disabled={!profileId || !promptText || submit.isPending}>
            {submit.isPending ? 'Generating plan…' : 'Generate Session Plan'}
          </button>
        </div>
      </form>
    </div>
  )
}
