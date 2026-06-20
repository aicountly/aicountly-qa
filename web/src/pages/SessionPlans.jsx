import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { SeverityBadge, StatusBadge } from '../components/Badges.jsx'
import { useAuth } from '../lib/auth.jsx'

export default function SessionPlans() {
  const [sp] = useSearchParams()
  const qaRunId = sp.get('qa_run_id') || ''
  const { hasRole } = useAuth()
  const canApprove = hasRole(['Owner', 'QA Manager'])

  const { data, isLoading } = useQuery({
    queryKey: ['session-plans', qaRunId],
    queryFn: async () => (await api.get(v1(`/session-plans${qaRunId ? `?qa_run_id=${encodeURIComponent(qaRunId)}` : ''}`))).data?.data ?? [],
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Review and edit the generated session plan. Sessions are run <strong>one at a time, in order</strong>; never in parallel.
      </p>

      {isLoading && <div className="text-neutral-500 text-sm">Loading…</div>}
      {(data || []).map((plan) => (
        <PlanCard key={plan.id} plan={plan} canApprove={canApprove} />
      ))}
      {!isLoading && (data || []).length === 0 && (
        <div className="qa-card text-sm text-neutral-500">
          No session plans yet. <Link to="/new-qa-run" className="text-aicountly-700">Start a new QA run →</Link>
        </div>
      )}
    </div>
  )
}

function PlanCard({ plan, canApprove }) {
  const qc = useQueryClient()
  const parsed = typeof plan.plan_json === 'string' ? JSON.parse(plan.plan_json) : plan.plan_json
  const [sessions, setSessions] = useState(parsed?.sessions || [])

  const save = useMutation({
    mutationFn: async () =>
      api.put(v1(`/session-plans/${plan.id}`), { plan_json: { ...parsed, sessions } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-plans'] }),
  })

  const approve = useMutation({
    mutationFn: async () =>
      api.post(v1(`/session-plans/${plan.id}/approve`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-plans'] }),
  })

  function move(idx, dir) {
    const next = [...sessions]
    const t = next[idx]
    next[idx] = next[idx + dir]
    next[idx + dir] = t
    next.forEach((s, i) => (s.order_index = i + 1))
    setSessions(next)
  }

  function remove(idx) {
    const next = sessions.filter((_, i) => i !== idx)
    next.forEach((s, i) => (s.order_index = i + 1))
    setSessions(next)
  }

  function updateName(idx, name) {
    const next = [...sessions]
    next[idx] = { ...next[idx], name }
    setSessions(next)
  }

  return (
    <div className="qa-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-neutral-900">{plan.qa_run_id}</div>
          <div className="text-xs text-neutral-500">
            {parsed?.product} · {parsed?.environment} · generated {parsed?.generated_at}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={plan.status} />
          {canApprove && plan.status === 'draft' && (
            <>
              <button type="button" className="qa-btn-secondary" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save edits'}
              </button>
              <button type="button" className="qa-btn-primary" onClick={() => approve.mutate()} disabled={approve.isPending}>
                {approve.isPending ? 'Approving…' : `Approve & queue (${sessions.length})`}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="qa-table">
          <thead>
            <tr><th>#</th><th>Session</th><th>Module</th><th>Sub-module</th><th>Severity</th><th>Validations</th><th></th></tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr key={`${plan.id}-${i}`}>
                <td>{s.order_index ?? i + 1}</td>
                <td>
                  <input
                    className="qa-input text-sm"
                    value={s.name}
                    onChange={(e) => updateName(i, e.target.value)}
                    disabled={plan.status !== 'draft'}
                  />
                  <div className="text-[11px] text-neutral-500 mt-0.5">{s.template_code}</div>
                </td>
                <td>{s.module}</td>
                <td>{s.sub_module || <span className="text-neutral-400">—</span>}</td>
                <td><SeverityBadge severity={s.severity_on_fail} /></td>
                <td className="text-[11px] text-neutral-600">{(s.validations || []).join(', ') || '—'}</td>
                <td className="text-right text-xs space-x-1">
                  {plan.status === 'draft' && (
                    <>
                      <button type="button" className="text-neutral-500 hover:text-neutral-800" onClick={() => i > 0 && move(i, -1)} disabled={i === 0}>↑</button>
                      <button type="button" className="text-neutral-500 hover:text-neutral-800" onClick={() => i < sessions.length - 1 && move(i, 1)} disabled={i === sessions.length - 1}>↓</button>
                      <button type="button" className="text-red-600 hover:text-red-800" onClick={() => remove(i)}>×</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr><td colSpan={7} className="text-xs text-neutral-500">No sessions in this plan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
