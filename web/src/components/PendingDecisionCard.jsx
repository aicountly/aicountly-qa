import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getToken, v1 } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function contextSnippet(context) {
  if (!context) return ''
  if (typeof context === 'string') return context
  if (context.snippet) return String(context.snippet)
  if (context.message) return String(context.message)
  if (context.detail) return String(context.detail)
  try {
    const s = JSON.stringify(context, null, 2)
    return s.length > 400 ? `${s.slice(0, 400).trim()}…` : s
  } catch {
    return ''
  }
}

function useDecisionScreenshot(qaRunId, decisionId, enabled) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false

    ;(async () => {
      setSrc('')
      setError('')
      if (!enabled || !qaRunId || !decisionId || !getToken()) return
      try {
        const res = await api.get(v1(`/runs/${encodeURIComponent(qaRunId)}/decisions/${decisionId}/screenshot`), {
          responseType: 'blob',
          headers: { 'Content-Type': undefined },
          timeout: 60_000,
        })
        if (cancelled) return

        const blob = res.data
        if (!(blob instanceof Blob) || blob.size === 0) {
          setError('No screenshot')
          return
        }
        if (blob.type && blob.type.includes('json')) {
          const text = await blob.text()
          let msg = 'Screenshot unavailable'
          try {
            msg = JSON.parse(text)?.error || msg
          } catch {
            /* keep default */
          }
          setError(msg)
          return
        }

        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (err) {
        if (cancelled) return
        const status = err?.response?.status
        if (status === 404) {
          setError('')
          return
        }
        setError(err?.response?.data?.error || err?.message || 'Screenshot unavailable')
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [qaRunId, decisionId, enabled])

  return { src, error }
}

function DecisionForm({ qaRunId, decision }) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canAnswer = hasRole(['Owner', 'QA Manager'])

  const options = useMemo(() => {
    const raw = parseJsonField(decision.options_json ?? decision.options, [])
    return Array.isArray(raw) ? raw : []
  }, [decision.options_json, decision.options])

  const recommended = options.find((o) => o?.recommended)?.id ?? options[0]?.id ?? ''
  const [selected, setSelected] = useState(recommended)
  const [freeText, setFreeText] = useState('')
  const [remember, setRemember] = useState(true)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    setSelected(recommended)
    setFreeText('')
    setRemember(true)
    setFormError('')
  }, [decision.id, recommended])

  const context = parseJsonField(decision.context_json ?? decision.context, null)
  const snippet = contextSnippet(context)
  const { src: screenshotSrc, error: screenshotError } = useDecisionScreenshot(qaRunId, decision.id, true)

  const answer = useMutation({
    mutationFn: async () => {
      const body = {
        selected_option: selected,
        free_text: freeText.trim() || null,
        remember: !!remember,
      }
      return (await api.post(
        v1(`/runs/${encodeURIComponent(qaRunId)}/decisions/${decision.id}/answer`),
        body,
      )).data
    },
    onSuccess: () => {
      setFormError('')
      qc.invalidateQueries({ queryKey: ['run-decisions', qaRunId] })
      qc.invalidateQueries({ queryKey: ['run', qaRunId] })
      qc.invalidateQueries({ queryKey: ['session-live'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
    onError: (err) => {
      setFormError(err?.response?.data?.error || err?.message || 'Failed to submit answer')
    },
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!selected) {
      setFormError('Select an option to continue.')
      return
    }
    answer.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            Awaiting decision
          </div>
          {decision.situation_key && (
            <div className="mt-0.5 font-mono text-[11px] text-amber-800/80">{decision.situation_key}</div>
          )}
        </div>
        <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-medium text-amber-950">
          Worker paused
        </span>
      </div>

      <p className="mt-2 text-sm font-medium text-neutral-900">{decision.question}</p>

      {snippet ? (
        <pre className="mt-2 max-h-28 overflow-auto rounded-md border border-amber-200/80 bg-white/70 p-2 text-[11px] leading-relaxed text-neutral-700 whitespace-pre-wrap">
          {snippet}
        </pre>
      ) : null}

      {(screenshotSrc || screenshotError) && (
        <div className="mt-3">
          {screenshotSrc ? (
            <a href={screenshotSrc} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-neutral-200 bg-white">
              <img src={screenshotSrc} alt="Decision context screenshot" className="max-h-48 w-full object-contain object-top" />
            </a>
          ) : (
            <p className="text-xs text-neutral-500">{screenshotError}</p>
          )}
        </div>
      )}

      <fieldset className="mt-3 space-y-2" disabled={!canAnswer || answer.isPending}>
        <legend className="sr-only">Options</legend>
        {options.length === 0 ? (
          <p className="text-xs text-red-700">No options were provided for this decision.</p>
        ) : (
          options.map((opt) => {
            const id = String(opt.id ?? opt.value ?? '')
            const label = opt.label ?? id
            const inputId = `decision-${decision.id}-${id}`
            return (
              <label
                key={id}
                htmlFor={inputId}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-200/70 bg-white/80 px-3 py-2 text-sm text-neutral-800 hover:border-amber-400"
              >
                <input
                  id={inputId}
                  type="radio"
                  name={`decision-${decision.id}`}
                  className="mt-1"
                  value={id}
                  checked={selected === id}
                  onChange={() => setSelected(id)}
                />
                <span>
                  {label}
                  {opt.recommended ? (
                    <span className="ml-2 rounded bg-aicountly-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-aicountly-800">
                      Recommended
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })
        )}
      </fieldset>

      <div className="mt-3">
        <label className="qa-label" htmlFor={`decision-note-${decision.id}`}>Optional note</label>
        <textarea
          id={`decision-note-${decision.id}`}
          className="qa-input min-h-[64px] text-sm"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          disabled={!canAnswer || answer.isPending}
          placeholder="Add context for the audit trail…"
        />
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-neutral-800">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          disabled={!canAnswer || answer.isPending}
        />
        Remember for future runs
      </label>

      {formError && (
        <p className="mt-2 text-xs text-red-700">{formError}</p>
      )}

      {!canAnswer ? (
        <p className="mt-3 text-xs text-amber-900">
          Only Owner or QA Manager can answer. Ask one of them to unblock this run.
        </p>
      ) : (
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            className="qa-btn-primary"
            disabled={answer.isPending || !selected}
          >
            {answer.isPending ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      )}
    </form>
  )
}

/**
 * Polls pending mid-run decisions for a QA run and renders answer cards.
 * Place above the session live log / run detail so operators can unblock the worker.
 */
export default function PendingDecisionCard({ qaRunId, enabled = true }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['run-decisions', qaRunId, 'pending'],
    queryFn: async () => {
      try {
        const res = await api.get(v1(`/runs/${encodeURIComponent(qaRunId)}/decisions`), {
          params: { status: 'pending' },
        })
        return res.data?.data ?? []
      } catch (err) {
        // Endpoint may not exist yet during rollout — treat as no pending decisions.
        const status = err?.response?.status
        if (status === 404 || status === 501) return []
        throw err
      }
    },
    enabled: !!qaRunId && enabled,
    refetchInterval: enabled ? 2000 : false,
    retry: (count, err) => {
      const status = err?.response?.status
      if (status === 404 || status === 501) return false
      return count < 2
    },
  })

  const decisions = Array.isArray(data) ? data : []

  if (!qaRunId || !enabled) return null
  if (isLoading && decisions.length === 0) return null
  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
        Could not load pending decisions. {error?.response?.data?.error || error?.message || ''}
      </div>
    )
  }
  if (decisions.length === 0) return null

  return (
    <div className="space-y-3">
      {decisions.map((d) => (
        <DecisionForm key={d.id} qaRunId={qaRunId} decision={d} />
      ))}
    </div>
  )
}

/** True when session/run statuses warrant decision polling. */
export function shouldPollDecisions(statuses = []) {
  const active = new Set(['queued', 'claimed', 'running', 'awaiting_decision', 'pending'])
  return statuses.some((s) => active.has(String(s || '').toLowerCase()))
}
