import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { EnvBadge } from '../components/Badges.jsx'
import ProductionBanner from '../components/ProductionBanner.jsx'
import { useEnvironments } from '../lib/useEnvironments.js'
import {
  allowsFileActions,
  environmentLabel,
  isObserverOnlyEnvironment,
} from '../lib/environments.js'
import { productLabel } from '../lib/products.js'

function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Used when `/v1/master-prompts-samples` is not deployed yet, so the sample
 * selector still gives operators a QA-shaped starting point.
 */
const FALLBACK_SAMPLES = [
  {
    id: 'local-login',
    label: 'Login smoke — errors only',
    description: 'Fastest way to confirm credentials and the post-login shell load without touching data.',
    prompt: 'Log in to the target app and stop there. Report any login failure, validation error, blank screen, HTTP 4xx/5xx response or console error. Do not create, edit or delete any data.',
  },
  {
    id: 'local-navigation',
    label: 'Menu walkthrough — error detection',
    description: 'Opens every menu and report page and records errors, broken pages and failed network calls.',
    prompt: 'Open every menu and sub-menu of the target app. For each screen record whether it loads without errors: capture console errors, failed network requests, server error pages, empty-state failures and broken layouts. Do not create data. Report every error with the exact screen, action and message.',
  },
  {
    id: 'local-data-correctness',
    label: 'Data correctness — entry to report',
    description: 'Creates deterministic records, then verifies stored and reported values match what was entered.',
    prompt: 'Using deterministic test data, create the core records for this product, then verify the data was processed and reported correctly. For every entry compare what was entered against what is stored, listed and shown in reports, and report any mismatch with expected vs actual values.',
  },
  {
    id: 'local-file-round-trip',
    label: 'File upload/download round-trip',
    description: 'Requires a writable target with safe demo enabled. Verifies exported data matches imported data.',
    prompt: 'Test the import and export workflows. Upload the synthetic source file, confirm the app accepts it without errors, then download or export the same data and verify the round-trip: row counts, column structure, totals and every field value must match the source. Report any mismatch, dropped row, format corruption or silent failure.',
  },
  {
    id: 'local-regression',
    label: 'Regression re-check after a fix',
    description: 'Re-verifies a previously failing workflow end to end and confirms the error no longer occurs.',
    prompt: 'Re-verify the workflow that previously failed. Walk the full end-to-end path, confirm no errors occur, and confirm the data entered is processed and output correctly. Report whether the earlier failure is fixed, still present, or replaced by a new error.',
  },
]

export default function NewQaRun() {
  const nav = useNavigate()
  const environments = useEnvironments()

  const [profileId, setProfileId] = useState('')
  const [title, setTitle] = useState(`QA Run - ${today()}`)
  const [environment, setEnvironment] = useState('sandbox')
  const [promptText, setPromptText] = useState('')
  const [sampleId, setSampleId] = useState('')

  // Only active profiles can start a run (the API rejects the rest with 409), so
  // the picker never offers a paused, disabled or archived target.
  const profiles = useQuery({
    queryKey: ['target-profiles', 'active'],
    queryFn: async () => {
      const rows = (await api.get(v1('/target-profiles'), { params: { status: 'active' } })).data?.data ?? []
      return rows.filter((p) => (p.status ?? 'active') === 'active')
    },
  })

  const selected = (profiles.data || []).find((p) => String(p.id) === String(profileId)) || null

  const samplesQ = useQuery({
    queryKey: ['master-prompt-samples', selected?.product_name || ''],
    queryFn: async () => {
      try {
        const res = await api.get(v1('/master-prompts-samples'), {
          params: selected?.product_name ? { product_name: selected.product_name } : undefined,
        })
        const data = res.data?.data || {}
        return {
          recommended: Array.isArray(data.recommended) ? data.recommended : [],
          other: Array.isArray(data.other) ? data.other : [],
          fallback: false,
        }
      } catch (err) {
        const status = err?.response?.status
        if (status === 404 || status === 501) {
          return { recommended: [], other: FALLBACK_SAMPLES, fallback: true }
        }
        throw err
      }
    },
    retry: false,
  })

  const recommended = samplesQ.data?.recommended ?? []
  const other = samplesQ.data?.other ?? []
  const allSamples = useMemo(() => [...recommended, ...other], [recommended, other])
  const selectedSample = allSamples.find((s) => String(s.id) === sampleId) || null

  // Environment follows the chosen profile but stays editable for one-off runs.
  useEffect(() => {
    if (selected?.environment) setEnvironment(selected.environment)
  }, [selected])

  function applySample(id) {
    setSampleId(id)
    if (!id) return
    const sample = allSamples.find((s) => String(s.id) === id)
    if (!sample) return
    setPromptText(sample.prompt || '')
    if (sample.product) {
      setTitle(`${sample.label} - ${today()}`)
    }
  }

  const submit = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(
        v1('/master-prompts'),
        {
          target_profile_id: Number(profileId),
          environment,
          title: title.trim(),
          prompt_text: promptText,
        },
        // Planning can take an LLM round-trip; the 30s client default aborts too early.
        { timeout: 120_000 },
      )
      return data?.data
    },
    onSuccess: (d) => {
      const planId = d?.plan_id ?? d?.session_plan?.id
      if (planId) {
        nav(`/session-plans/${planId}`)
      } else if (d?.qa_run_id) {
        nav(`/session-plans?qa_run_id=${encodeURIComponent(d.qa_run_id)}`)
      }
    },
  })

  const submitError = (() => {
    if (!submit.error) return null
    if (submit.error?.code === 'ECONNABORTED') {
      return 'Plan generation timed out. Try again — planning normally completes within a minute.'
    }
    return submit.error?.response?.data?.error
      || submit.error?.message
      || 'Failed to generate the session plan.'
  })()

  const envDrift = selected?.environment && selected.environment !== environment
  const observerOnly = isObserverOnlyEnvironment(environment)
  const fileActionsBlocked = !allowsFileActions(environment)

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">New QA Run</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Describe what must be verified. QA splits the master prompt into module-wise sessions for
          you to review before anything runs, then checks each workflow for errors and verifies the
          data entered, processed and reported.
        </p>
      </div>

      <ProductionBanner environment={environment} profileName={selected?.profile_name} />

      <form
        className="qa-card space-y-4"
        onSubmit={(e) => { e.preventDefault(); submit.mutate() }}
      >
        <div>
          <label className="qa-label" htmlFor="qa-run-title">Title</label>
          <input
            id="qa-run-title"
            className="qa-input"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`QA Run - ${today()}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="qa-label" htmlFor="qa-run-profile">Target App Profile</label>
            <select
              id="qa-run-profile"
              className="qa-input"
              required
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              <option value="">Select a profile…</option>
              {(profiles.data || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.profile_name} ({productLabel(p.product_name)})
                </option>
              ))}
            </select>
            {!profiles.isLoading && (profiles.data || []).length === 0 && (
              <p className="mt-1 text-[11px] text-amber-800">
                No active target profiles. Create one, or set an existing profile back to active.
              </p>
            )}
            {selected && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <EnvBadge environment={selected.environment} />
                <span className="font-mono">{selected.base_url}</span>
                {selected.has_credentials === false && (
                  <span className="qa-badge bg-amber-100 text-amber-900">credentials missing</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="qa-label" htmlFor="qa-run-environment">Environment</label>
            <select
              id="qa-run-environment"
              className="qa-input"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              {environments.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
            {envDrift && (
              <p className="mt-1 text-[11px] text-amber-800">
                Profile is configured for {environmentLabel(selected.environment)}. This run will be
                recorded against {environmentLabel(environment)}.
              </p>
            )}
            {observerOnly && (
              <p className="mt-1 text-[11px] text-neutral-500">
                Observer-only tier: sessions verify existing data and report errors without creating
                or changing anything.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
            <label className="qa-label mb-0" htmlFor="qa-run-prompt">Master Prompt</label>
            <div className="min-w-[min(100%,280px)] flex-1 sm:flex-none">
              <label className="sr-only" htmlFor="qa-run-sample">Sample prompt</label>
              <select
                id="qa-run-sample"
                className="qa-input text-neutral-600"
                value={sampleId}
                onChange={(e) => applySample(e.target.value)}
                disabled={allSamples.length === 0}
              >
                <option value="">
                  {samplesQ.isLoading ? 'Loading samples…' : 'Choose a sample prompt…'}
                </option>
                {recommended.length > 0 && (
                  <optgroup label={`Recommended for ${selected?.profile_name || 'this profile'}`}>
                    {recommended.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </optgroup>
                )}
                {other.length > 0 && (
                  <optgroup label={recommended.length > 0 ? 'Other samples' : 'Sample prompts'}>
                    {other.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>

          {selectedSample?.description && (
            <p className="mb-2 text-xs text-neutral-500">{selectedSample.description}</p>
          )}

          <textarea
            id="qa-run-prompt"
            required
            className="qa-input min-h-[160px] font-mono"
            value={promptText}
            onChange={(e) => {
              setPromptText(e.target.value)
              if (sampleId) setSampleId('')
            }}
            placeholder="e.g. Verify every voucher entry screen accepts valid data without errors, then confirm the saved values match GST, Trial Balance and P&L reports. Report every error with expected vs actual."
          />

          {fileActionsBlocked && (
            <p className="mt-2 text-[11px] text-amber-800">
              File upload/download round-trips are blocked on {environmentLabel(environment)}. Use a
              sandbox, staging or full-access profile with “allow safe demo” enabled for file checks.
            </p>
          )}
        </div>

        {submitError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
            {submitError}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            className="qa-btn-primary"
            disabled={!profileId || !promptText.trim() || submit.isPending}
          >
            {submit.isPending ? 'Generating plan…' : 'Generate Session Plan'}
          </button>
        </div>
      </form>
    </div>
  )
}
