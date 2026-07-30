import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, SeverityBadge, StatusBadge } from '../components/Badges.jsx'
import { useAuth } from '../lib/auth.jsx'
import { fmtDate } from '../lib/format.js'
import { productLabel } from '../lib/products.js'

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'warning']
const EXEC_ACTIVE = ['queued', 'claimed', 'running', 'awaiting_decision']
const RERUNNABLE = ['completed', 'failed', 'skipped', 'partial', 'blocked_by_safe_guard']

const EMPTY_SESSION = {
  name: '',
  module: '',
  sub_module: '',
  template_code: '',
  severity_on_fail: 'medium',
  validations: '',
  expected_screens: '',
}

function parsePlanJson(plan) {
  if (!plan) return null
  if (typeof plan.plan_json === 'string') {
    try { return JSON.parse(plan.plan_json) } catch { return {} }
  }
  return plan.plan_json || {}
}

function toCsv(value) {
  if (Array.isArray(value)) return value.join(', ')
  return String(value ?? '')
}

function fromCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function reindex(rows) {
  return rows.map((s, i) => ({ ...s, order_index: i + 1 }))
}

/** Plans generated before the field was renamed still carry `estimated_screens`. */
function screenEstimate(session) {
  const raw = session?.expected_screens ?? session?.estimated_screens
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export default function SessionPlanDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canApprove = hasRole(['Owner', 'QA Manager'])
  const canRerun = canApprove

  // `draft` holds unsaved reorder/edit/add/delete work; null means "show the server plan".
  const [draft, setDraft] = useState(null)
  const [editingIdx, setEditingIdx] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_SESSION)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_SESSION)
  const [notice, setNotice] = useState('')

  const planQ = useQuery({
    queryKey: ['session-plan', id],
    queryFn: async () => (await api.get(v1(`/session-plans/${id}`))).data?.data,
  })

  const plan = planQ.data
  const parsed = parsePlanJson(plan)
  const isDraft = plan?.status === 'draft'
  const editable = canApprove && isDraft

  const planSessions = useMemo(
    () => (Array.isArray(parsed?.sessions) ? parsed.sessions : []),
    [parsed],
  )
  const sessions = draft ?? planSessions
  const dirty = draft !== null

  // Reset local edits whenever a fresh plan version arrives from the server.
  useEffect(() => {
    setDraft(null)
    setEditingIdx(null)
    setAddOpen(false)
  }, [plan?.id, plan?.status, plan?.updated_at])

  const execSessions = useQuery({
    queryKey: ['sessions-for-plan', plan?.qa_run_id],
    queryFn: async () => (await api.get(v1(`/sessions?qa_run_id=${encodeURIComponent(plan.qa_run_id)}`))).data?.data ?? [],
    enabled: !!plan?.qa_run_id && plan?.status === 'approved',
    refetchInterval: (q) => {
      const rows = q.state.data || []
      return rows.some((s) => EXEC_ACTIVE.includes(s.status)) ? 3000 : false
    },
  })

  const save = useMutation({
    mutationFn: async (rows) =>
      api.put(v1(`/session-plans/${plan.id}`), { plan_json: { ...parsed, sessions: rows ?? sessions } }),
    onSuccess: () => {
      setDraft(null)
      setNotice('Plan saved.')
      qc.invalidateQueries({ queryKey: ['session-plan', id] })
      qc.invalidateQueries({ queryKey: ['session-plans'] })
    },
  })

  const approve = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await api.put(v1(`/session-plans/${plan.id}`), { plan_json: { ...parsed, sessions } })
      }
      return api.post(v1(`/session-plans/${plan.id}/approve`))
    },
    onSuccess: () => {
      setDraft(null)
      setNotice('')
      qc.invalidateQueries({ queryKey: ['session-plan', id] })
      qc.invalidateQueries({ queryKey: ['sessions-for-plan', plan.qa_run_id] })
      qc.invalidateQueries({ queryKey: ['session-plans'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const reject = useMutation({
    mutationFn: async (reason) => api.post(v1(`/session-plans/${plan.id}/reject`), { reason: reason || null }),
    onSuccess: () => {
      setNotice('')
      qc.invalidateQueries({ queryKey: ['session-plan', id] })
      qc.invalidateQueries({ queryKey: ['session-plans'] })
    },
    onError: (err) => {
      const status = err?.response?.status
      if (status === 404 || status === 501) {
        setNotice('Reject is not available on this API version yet. Leave the plan in draft instead.')
      }
    },
  })

  const rerun = useMutation({
    mutationFn: async (sessionId) => api.post(v1(`/sessions/${sessionId}/rerun`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions-for-plan', plan?.qa_run_id] })
      qc.invalidateQueries({ queryKey: ['run', plan?.qa_run_id] })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  function mutateSessions(next) {
    setDraft(reindex(next))
    setNotice('')
  }

  function move(idx, dir) {
    const target = idx + dir
    if (target < 0 || target >= sessions.length) return
    const next = [...sessions]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    mutateSessions(next)
    setEditingIdx(null)
  }

  function removeSession(idx) {
    const row = sessions[idx]
    if (!window.confirm(`Remove “${row?.name || 'this session'}” from the plan?`)) return
    mutateSessions(sessions.filter((_, i) => i !== idx))
    setEditingIdx(null)
  }

  function beginEdit(idx) {
    const s = sessions[idx]
    setEditingIdx(idx)
    setEditForm({
      name: s.name ?? '',
      module: s.module ?? '',
      sub_module: s.sub_module ?? '',
      template_code: s.template_code ?? '',
      severity_on_fail: s.severity_on_fail ?? 'medium',
      validations: toCsv(s.validations),
      expected_screens: screenEstimate(s) ?? '',
    })
  }

  function commitEdit() {
    if (editingIdx == null) return
    const next = [...sessions]
    const screens = Number(editForm.expected_screens)
    next[editingIdx] = {
      ...next[editingIdx],
      name: editForm.name.trim(),
      module: editForm.module.trim() || null,
      sub_module: editForm.sub_module.trim() || null,
      template_code: editForm.template_code.trim() || next[editingIdx].template_code,
      severity_on_fail: editForm.severity_on_fail,
      validations: fromCsv(editForm.validations),
      ...(Number.isFinite(screens) && screens > 0 ? { expected_screens: screens } : {}),
    }
    mutateSessions(next)
    setEditingIdx(null)
  }

  function commitAdd() {
    const screens = Number(addForm.expected_screens)
    const row = {
      name: addForm.name.trim(),
      module: addForm.module.trim() || null,
      sub_module: addForm.sub_module.trim() || null,
      template_code: addForm.template_code.trim() || 'CUSTOM',
      severity_on_fail: addForm.severity_on_fail,
      validations: fromCsv(addForm.validations),
      steps_preview: [],
      data_keys: [],
      ...(Number.isFinite(screens) && screens > 0 ? { expected_screens: screens } : {}),
    }
    mutateSessions([...sessions, row])
    setAddForm(EMPTY_SESSION)
    setAddOpen(false)
  }

  function handleReject() {
    const reason = window.prompt('Reject reason (optional):') ?? ''
    if (!window.confirm('Reject this session plan? Nothing will be queued for the worker.')) return
    reject.mutate(reason.trim())
  }

  function handleRerun(exec) {
    if (!exec?.id) return
    if (!window.confirm(
      `Re-run “${exec.name || 'this session'}”?\n\nPrior results, screenshots, and the live log for this session will be cleared, then the worker will pick it up again.`,
    )) return
    rerun.mutate(exec.id)
  }

  function findExec(planSession) {
    const rows = execSessions.data || []
    return rows.find(
      (s) => s.template_code === planSession.template_code
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

  const approved = plan.status === 'approved'
  const saveError = save.error || approve.error || reject.error

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/session-plans" className="text-xs text-aicountly-700 hover:underline">← All session plans</Link>
        {approved && (
          <Link to={`/qa-runs/${encodeURIComponent(plan.qa_run_id)}`} className="text-xs text-aicountly-700 hover:underline">
            Open QA run →
          </Link>
        )}
      </div>

      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Session Plan #{plan.id}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Review and edit the generated plan before anything runs. Sessions execute{' '}
          <strong>one at a time, in order</strong> — never in parallel.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Any screen or step counts shown here are planning estimates only. QA does not cap discovery:
          the worker keeps testing every screen it finds in a module and reports every error it hits.
        </p>
      </div>

      <div className="qa-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-sm font-semibold text-neutral-900">{plan.qa_run_id}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>{productLabel(parsed?.product) || '—'}</span>
              <EnvBadge environment={parsed?.environment} />
              <span>generated {fmtDate(parsed?.generated_at)}</span>
              <span>· {sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge status={plan.status} />
            <button type="button" className="qa-btn-secondary text-xs" onClick={() => planQ.refetch()}>
              Refresh
            </button>
            {editable && (
              <>
                <button
                  type="button"
                  className="qa-btn-secondary text-xs"
                  onClick={() => { setAddOpen((v) => !v); setEditingIdx(null) }}
                >
                  {addOpen ? 'Cancel add' : '+ Add session'}
                </button>
                <button
                  type="button"
                  className="qa-btn-secondary text-xs"
                  onClick={() => save.mutate(sessions)}
                  disabled={!dirty || save.isPending}
                >
                  {save.isPending ? 'Saving…' : 'Save edits'}
                </button>
                <button
                  type="button"
                  className="qa-btn-danger text-xs"
                  onClick={handleReject}
                  disabled={reject.isPending}
                >
                  {reject.isPending ? 'Rejecting…' : 'Reject'}
                </button>
                <button
                  type="button"
                  className="qa-btn-primary text-xs"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending || sessions.length === 0}
                >
                  {approve.isPending ? 'Approving…' : `Approve & queue (${sessions.length})`}
                </button>
              </>
            )}
            {canApprove && approved && (
              <Link to={`/qa-runs/${encodeURIComponent(plan.qa_run_id)}`} className="qa-btn-primary text-xs">
                Start / monitor QA run
              </Link>
            )}
          </div>
        </div>

        {editable && dirty && (
          <p className="text-xs text-amber-800">
            Unsaved plan edits. Approving saves them first, so the worker always runs what you see here.
          </p>
        )}
        {approved && (
          <p className="text-xs text-neutral-600">
            Plan approved — sessions are queued in this order. Open the QA run to watch progress,
            answer worker decisions, and review errors, data verification and file round-trips.
          </p>
        )}
        {plan.status === 'rejected' && (
          <p className="text-xs text-red-800">
            Plan rejected{plan.rejected_reason ? `: ${plan.rejected_reason}` : ''}. Generate a new
            plan from a fresh master prompt to run this target.
          </p>
        )}
        {notice && <p className="text-xs text-neutral-600">{notice}</p>}
        {saveError && (
          <p className="text-xs text-red-700">
            {saveError?.response?.data?.error || saveError?.message || 'Action failed.'}
          </p>
        )}

        {addOpen && editable && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="text-sm font-semibold text-neutral-900">New session</div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="qa-label">Session name</label>
                <input
                  className="qa-input"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  placeholder="Sales invoice — data correctness"
                />
              </div>
              <div>
                <label className="qa-label">Module</label>
                <input className="qa-input" value={addForm.module} onChange={(e) => setAddForm({ ...addForm, module: e.target.value })} />
              </div>
              <div>
                <label className="qa-label">Sub-module</label>
                <input className="qa-input" value={addForm.sub_module} onChange={(e) => setAddForm({ ...addForm, sub_module: e.target.value })} />
              </div>
              <div>
                <label className="qa-label">Template code</label>
                <input className="qa-input font-mono text-xs" value={addForm.template_code} onChange={(e) => setAddForm({ ...addForm, template_code: e.target.value })} placeholder="CUSTOM" />
              </div>
              <div>
                <label className="qa-label">Severity on failure</label>
                <select className="qa-input" value={addForm.severity_on_fail} onChange={(e) => setAddForm({ ...addForm, severity_on_fail: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="qa-label">Validation rule codes (comma-separated)</label>
                <input className="qa-input font-mono text-xs" value={addForm.validations} onChange={(e) => setAddForm({ ...addForm, validations: e.target.value })} placeholder="GST_OUTPUT_MATCH, TRIAL_BALANCE_TALLY" />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" className="qa-btn-primary text-xs" disabled={!addForm.name.trim()} onClick={commitAdd}>
                Add to plan
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
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
                const showLive = !!exec && EXEC_ACTIVE.includes(exec.status)
                const canRerunRow = canRerun && !!exec && RERUNNABLE.includes(exec.status)
                const isEditing = editingIdx === i
                return (
                  <Fragment key={`${plan.id}-${i}`}>
                    <tr>
                      <td>{s.order_index ?? i + 1}</td>
                      <td>
                        <div className="font-medium text-neutral-900">{s.name || <span className="text-neutral-400">Untitled session</span>}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                          <span className="font-mono">{s.template_code}</span>
                          {screenEstimate(s) ? (
                            <span className="qa-badge bg-neutral-100 text-neutral-600" title="Planning estimate only — discovery is not capped">
                              est. {screenEstimate(s)} screens
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{s.module || <span className="text-neutral-400">—</span>}</td>
                      <td>{s.sub_module || <span className="text-neutral-400">—</span>}</td>
                      <td><SeverityBadge severity={s.severity_on_fail} /></td>
                      <td className="text-[11px] text-neutral-600">{toCsv(s.validations) || '—'}</td>
                      <td>
                        {exec ? <StatusBadge status={exec.status} /> : (
                          <span className="text-xs text-neutral-400">{isDraft ? 'draft' : '—'}</span>
                        )}
                      </td>
                      <td className="space-x-2 whitespace-nowrap text-right text-xs">
                        {exec && (
                          <Link
                            to={`/sessions/${exec.id}/log?name=${encodeURIComponent(exec.name || s.name || '')}&from=${encodeURIComponent(`/session-plans/${id}`)}&fromLabel=${encodeURIComponent('Session plan')}`}
                            className={`font-medium hover:underline ${showLive ? 'text-aicountly-700' : 'text-neutral-600'}`}
                          >
                            View log
                          </Link>
                        )}
                        {canRerunRow && (
                          <button
                            type="button"
                            className="font-medium text-amber-800 hover:underline disabled:opacity-50"
                            disabled={rerun.isPending}
                            onClick={() => handleRerun(exec)}
                          >
                            {rerun.isPending && rerun.variables === exec.id ? 'Re-queuing…' : 'Re-run'}
                          </button>
                        )}
                        {editable && (
                          <>
                            <button
                              type="button"
                              className="font-medium text-neutral-700 hover:underline"
                              onClick={() => (isEditing ? setEditingIdx(null) : beginEdit(i))}
                            >
                              {isEditing ? 'Close' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              className="text-neutral-500 hover:text-neutral-800 disabled:opacity-30"
                              title="Move up"
                              onClick={() => move(i, -1)}
                              disabled={i === 0}
                            >↑</button>
                            <button
                              type="button"
                              className="text-neutral-500 hover:text-neutral-800 disabled:opacity-30"
                              title="Move down"
                              onClick={() => move(i, 1)}
                              disabled={i === sessions.length - 1}
                            >↓</button>
                            <button
                              type="button"
                              className="font-medium text-red-600 hover:underline"
                              onClick={() => removeSession(i)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-neutral-50">
                        <td colSpan={8}>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <label className="qa-label">Session name</label>
                              <input className="qa-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                            </div>
                            <div>
                              <label className="qa-label">Module</label>
                              <input className="qa-input" value={editForm.module} onChange={(e) => setEditForm({ ...editForm, module: e.target.value })} />
                            </div>
                            <div>
                              <label className="qa-label">Sub-module</label>
                              <input className="qa-input" value={editForm.sub_module} onChange={(e) => setEditForm({ ...editForm, sub_module: e.target.value })} />
                            </div>
                            <div>
                              <label className="qa-label">Template code</label>
                              <input className="qa-input font-mono text-xs" value={editForm.template_code} onChange={(e) => setEditForm({ ...editForm, template_code: e.target.value })} />
                            </div>
                            <div>
                              <label className="qa-label">Severity on failure</label>
                              <select className="qa-input" value={editForm.severity_on_fail} onChange={(e) => setEditForm({ ...editForm, severity_on_fail: e.target.value })}>
                                {SEVERITIES.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
                              </select>
                            </div>
                            <div className="sm:col-span-2">
                              <label className="qa-label">Validation rule codes (comma-separated)</label>
                              <input className="qa-input font-mono text-xs" value={editForm.validations} onChange={(e) => setEditForm({ ...editForm, validations: e.target.value })} />
                            </div>
                            {screenEstimate(s) ? (
                              <div>
                                <label className="qa-label">Est. screens</label>
                                <input
                                  type="number"
                                  min={1}
                                  className="qa-input"
                                  value={editForm.expected_screens}
                                  onChange={(e) => setEditForm({ ...editForm, expected_screens: e.target.value })}
                                />
                                <p className="mt-1 text-[11px] text-neutral-500">
                                  Planning estimate only — QA keeps testing every screen it discovers.
                                </p>
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <button type="button" className="qa-btn-secondary text-xs" onClick={() => setEditingIdx(null)}>Cancel</button>
                            <button type="button" className="qa-btn-primary text-xs" disabled={!editForm.name.trim()} onClick={commitEdit}>
                              Apply
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-xs text-neutral-500">
                    No sessions in this plan. {editable ? 'Add at least one session before approving.' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
