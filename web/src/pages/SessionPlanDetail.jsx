import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { SeverityBadge, StatusBadge } from '../components/Badges.jsx'
import SessionLiveLog from '../components/SessionLiveLog.jsx'
import { useAuth } from '../lib/auth.jsx'
import { fmtDate } from '../lib/format.js'

function parsePlanJson(plan) {
  if (!plan) return null
  if (typeof plan.plan_json === 'string') {
    try { return JSON.parse(plan.plan_json) } catch { return {} }
  }
  return plan.plan_json || {}
}

export default function SessionPlanDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canApprove = hasRole(['Owner', 'QA Manager'])
  const [liveSession, setLiveSession] = useState(null)
  const [sessions, setSessions] = useState([])

  const planQ = useQuery({
    queryKey: ['session-plan', id],
    queryFn: async () => (await api.get(v1(`/session-plans/${id}`))).data?.data,
  })

  const plan = planQ.data
  const parsed = parsePlanJson(plan)

  useEffect(() => {
    if (!plan) return
    const p = parsePlanJson(plan)
    setSessions(Array.isArray(p?.sessions) ? p.sessions : [])
  }, [plan])

  const execSessions = useQuery({
    queryKey: ['sessions-for-plan', plan?.qa_run_id],
    queryFn: async () => (await api.get(v1(`/sessions?qa_run_id=${encodeURIComponent(plan.qa_run_id)}`))).data?.data ?? [],
    enabled: !!plan?.qa_run_id && plan?.status === 'approved',
    refetchInterval: (q) => {
      const rows = q.state.data || []
      const active = rows.some((s) => ['queued', 'claimed', 'running'].includes(s.status))
      return active ? 3000 : false
    },
  })

  const save = useMutation({
    mutationFn: async () =>
      api.put(v1(`/session-plans/${plan.id}`), { plan_json: { ...parsed, sessions } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-plan', id] })
      qc.invalidateQueries({ queryKey: ['session-plans'] })
    },
  })

  const approve = useMutation({
    mutationFn: async () => api.post(v1(`/session-plans/${plan.id}/approve`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-plan', id] })
      qc.invalidateQueries({ queryKey: ['sessions-for-plan', plan.qa_run_id] })
      qc.invalidateQueries({ queryKey: ['session-plans'] })
    },
  })

  function move(idx, dir) {
    const next = [...sessions]
    const t = next[idx]
    next[idx] = next[idx + dir]
    next[idx + dir] = t
    next.forEach((s, i) => { s.order_index = i + 1 })
    setSessions(next)
  }

  function remove(idx) {
    const next = sessions.filter((_, i) => i !== idx)
    next.forEach((s, i) => { s.order_index = i + 1 })
    setSessions(next)
  }

  function updateName(idx, name) {
    const next = [...sessions]
    next[idx] = { ...next[idx], name }
    setSessions(next)
  }

  function findExec(planSession) {
    const rows = execSessions.data || []
    return rows.find(
      (s) =>
        s.template_code === planSession.template_code
        && Number(s.order_index) === Number(planSession.order_index ?? 0),
    ) || rows.find((s) => s.template_code === planSession.template_code)
  }

  if (planQ.isLoading) return <div className="text-sm text-neutral-500">Loading…</div>
  if (!plan) {
    return (
      <div className="qa-card text-sm text-neutral-600">
        Session plan not found.{' '}
        <Link to="/session-plans" className="text-aicountly-700 hover:underline">Back to listing →</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/session-plans" className="text-xs text-aicountly-700 hover:underline">← All session plans</Link>
        {plan.status === 'approved' && (
          <Link to={`/qa-runs/${encodeURIComponent(plan.qa_run_id)}`} className="text-xs text-aicountly-700 hover:underline">
            Open QA run →
          </Link>
        )}
      </div>

      <p className="text-sm text-neutral-600">
        Review and edit the generated session plan. Sessions are run <strong>one at a time, in order</strong>; never in parallel.
      </p>

      <div className="qa-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-neutral-900">{plan.qa_run_id}</div>
            <div className="text-xs text-neutral-500">
              {parsed?.product} · {parsed?.environment} · generated {fmtDate(parsed?.generated_at)}
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
              <tr>
                <th>#</th>
                <th>Session</th>
                <th>Module</th>
                <th>Sub-module</th>
                <th>Severity</th>
                <th>Validations</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => {
                const exec = findExec(s)
                const canViewLog = !!exec
                const showLive = !!exec && ['queued', 'claimed', 'running'].includes(exec.status)
                return (
                  <tr key={`${plan.id}-${i}`}>
                    <td>{s.order_index ?? i + 1}</td>
                    <td>
                      <input
                        className="qa-input text-sm"
                        value={s.name}
                        onChange={(e) => updateName(i, e.target.value)}
                        disabled={plan.status !== 'draft'}
                      />
                      <div className="mt-0.5 text-[11px] text-neutral-500">{s.template_code}</div>
                    </td>
                    <td>{s.module}</td>
                    <td>{s.sub_module || <span className="text-neutral-400">—</span>}</td>
                    <td><SeverityBadge severity={s.severity_on_fail} /></td>
                    <td className="text-[11px] text-neutral-600">{(s.validations || []).join(', ') || '—'}</td>
                    <td>
                      {exec ? <StatusBadge status={exec.status} /> : (
                        <span className="text-xs text-neutral-400">{plan.status === 'draft' ? 'draft' : '—'}</span>
                      )}
                    </td>
                    <td className="space-x-2 whitespace-nowrap text-right text-xs">
                      {canViewLog && (
                        <button
                          type="button"
                          className={`font-medium hover:underline ${showLive ? 'text-aicountly-700' : 'text-neutral-600'}`}
                          onClick={() => setLiveSession({ id: exec.id, name: exec.name || s.name })}
                        >
                          View log
                        </button>
                      )}
                      {plan.status === 'draft' && (
                        <>
                          <button type="button" className="text-neutral-500 hover:text-neutral-800" onClick={() => i > 0 && move(i, -1)} disabled={i === 0}>↑</button>
                          <button type="button" className="text-neutral-500 hover:text-neutral-800" onClick={() => i < sessions.length - 1 && move(i, 1)} disabled={i === sessions.length - 1}>↓</button>
                          <button type="button" className="text-red-600 hover:text-red-800" onClick={() => remove(i)}>×</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              {sessions.length === 0 && (
                <tr><td colSpan={8} className="text-xs text-neutral-500">No sessions in this plan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {liveSession && (
        <SessionLiveLog
          sessionId={liveSession.id}
          sessionName={liveSession.name}
          onClose={() => setLiveSession(null)}
        />
      )}
    </div>
  )
}
