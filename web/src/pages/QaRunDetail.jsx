import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, SeverityBadge, StatusBadge } from '../components/Badges.jsx'
import PendingDecisionCard, { shouldPollDecisions } from '../components/PendingDecisionCard.jsx'
import { classNames, fmtDate } from '../lib/format.js'
import { useAuth } from '../lib/auth.jsx'
import { copyText } from '../lib/clipboard.js'
import { narrowToRun } from '../lib/errorRegister.js'
import { PromptsUnavailableError, fetchRunPrompts, fetchSessionPrompts } from '../lib/prompts.js'

const ACTIVE_SESSION_STATUSES = ['queued', 'claimed', 'running', 'awaiting_decision']
const LOCKED_SESSION_STATUSES = ['claimed', 'running', 'awaiting_decision']
const CANCELLABLE_RUN_STATUSES = ['pending', 'running']

const TABS = [
  ['errors', 'Errors'],
  ['validations', 'Validations'],
  ['file-io', 'File I/O'],
  ['evidence', 'Evidence & screenshots'],
]

function humanizeFatalError(msg) {
  if (!msg) return null
  if (msg.includes('status code 404')) {
    return 'Target app credentials are not configured. Set the password under Target App Profiles → Edit.'
  }
  if (msg.includes('status code 401')) {
    return 'Worker could not authenticate with the QA API (check QA_WORKER_TOKEN).'
  }
  return msg
}

function shortHash(value) {
  const s = String(value ?? '')
  if (!s) return '—'
  return s.length <= 14 ? s : `${s.slice(0, 12)}…`
}

function fmtBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The API reports the mismatch count in `mismatched_cells` and the offending
 * cells in `mismatches`; older payloads sent a bare number.
 */
function mismatchCount(row) {
  if (row.mismatched_cells != null) return Number(row.mismatched_cells)
  if (Array.isArray(row.mismatches)) return row.mismatches.length
  if (row.mismatches == null) return null
  const n = Number(row.mismatches)
  return Number.isFinite(n) ? n : null
}

function mismatchDetail(row) {
  if (!Array.isArray(row.mismatches) || row.mismatches.length === 0) return undefined
  return row.mismatches
    .slice(0, 5)
    .map((m) => (typeof m === 'string' ? m : JSON.stringify(m)))
    .join('\n')
}

function compareStatusClass(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'pass' || s === 'passed' || s === 'match') return 'bg-aicountly-100 text-aicountly-800'
  if (s === 'not_applicable' || s === 'skipped') return 'bg-neutral-100 text-neutral-600'
  if (s === 'pending' || s === 'running') return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-800'
}

function compareStatusLabel(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'not_applicable') return 'not comparable'
  return status || '—'
}

function SessionIssue({ summary }) {
  if (!summary) return <span className="text-xs text-neutral-400">—</span>

  const fatal = humanizeFatalError(summary.fatal_error)
  const showPrompt = summary.suggested_prompt && !!fatal

  return (
    <div className="max-w-md space-y-1">
      {fatal && <p className="text-xs font-medium text-red-800">{fatal}</p>}
      {fatal && summary.suggested_area && (
        <p className="text-xs text-amber-900">Likely area: {summary.suggested_area}</p>
      )}
      {showPrompt && (
        <p className="text-xs text-neutral-600 line-clamp-4" title={summary.suggested_prompt}>
          {summary.suggested_prompt}
        </p>
      )}
      {!fatal && summary.suggested_area && (
        <p className="text-xs text-amber-900">{summary.suggested_area}</p>
      )}
      {!fatal && !showPrompt && summary.failed_count > 0 && (
        <p className="text-xs text-amber-800">
          {summary.failed_count} check{summary.failed_count === 1 ? '' : 's'} failed
          {summary.severity ? ` · ${summary.severity}` : ''}
        </p>
      )}
    </div>
  )
}

function RowCount({ expected, found }) {
  const e = expected ?? null
  const f = found ?? null
  if (e == null && f == null) return <span className="text-neutral-400">—</span>
  const mismatch = e != null && f != null && Number(e) !== Number(f)
  return (
    <span className={mismatch ? 'font-medium text-red-700' : 'text-neutral-700'}>
      {e ?? '—'} / {f ?? '—'}
    </span>
  )
}

function FileIoTable({ qaRunId, rows }) {
  const [error, setError] = useState('')

  async function download(testId, key, scenarioKey) {
    setError('')
    try {
      const res = await api.get(
        v1(`/runs/${encodeURIComponent(qaRunId)}/file-io/${testId}/artifact/${encodeURIComponent(key)}`),
        { responseType: 'blob', headers: { 'Content-Type': undefined }, timeout: 60_000 },
      )
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${scenarioKey || 'file-io'}-${key}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err?.response?.status === 404
        ? 'Artifact is no longer on disk.'
        : err?.message || 'Download failed.')
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">
        Synthetic upload/download round-trips. A round-trip passes only when the returned file matches
        the source: same structure, same row count and every verified value equal.
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        <table className="qa-table">
          <thead>
            <tr>
              <th>Result</th>
              <th>Scenario</th>
              <th>Direction</th>
              <th>Source → result hash</th>
              <th>MIME</th>
              <th>Size</th>
              <th>Structure</th>
              <th title="Rows expected / rows found">Rows exp / found</th>
              <th className="text-right">Mismatches</th>
              <th>Verification notes</th>
              <th>Artifacts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className={classNames('qa-badge', compareStatusClass(r.compare_status))}>
                    {compareStatusLabel(r.compare_status)}
                  </span>
                </td>
                <td className="font-medium text-neutral-900">
                  {r.scenario_key}
                  {r.session_id ? (
                    <Link
                      to={`/sessions/${r.session_id}/log`}
                      className="mt-0.5 block text-[11px] font-normal text-aicountly-700 hover:underline"
                    >
                      session #{r.session_id}
                    </Link>
                  ) : null}
                </td>
                <td className="text-xs">{r.direction || '—'}</td>
                <td className="font-mono text-[11px] text-neutral-600">
                  <div title={r.source_sha256 || ''}>src {shortHash(r.source_sha256)}</div>
                  <div title={r.result_sha256 || ''}>res {shortHash(r.result_sha256)}</div>
                </td>
                <td className="text-[11px] text-neutral-600">
                  <div>{r.source_mime || '—'}</div>
                  <div>{r.result_mime || '—'}</div>
                </td>
                <td className="text-[11px] text-neutral-600">
                  <div>{fmtBytes(r.source_bytes)}</div>
                  <div>{fmtBytes(r.result_bytes)}</div>
                </td>
                <td>
                  {r.structure_ok == null ? (
                    <span className="text-xs text-neutral-400">—</span>
                  ) : r.structure_ok ? (
                    <span className="qa-badge bg-aicountly-100 text-aicountly-800">ok</span>
                  ) : (
                    <span className="qa-badge bg-red-100 text-red-800" title={r.structure_notes || ''}>broken</span>
                  )}
                  {r.structure_notes && (
                    <div className="mt-0.5 max-w-[12rem] text-[11px] text-neutral-500">{r.structure_notes}</div>
                  )}
                </td>
                <td className="text-xs tabular-nums">
                  <RowCount expected={r.rows_expected} found={r.rows_found} />
                </td>
                <td className="text-right text-xs tabular-nums">
                  {mismatchCount(r) == null ? '—' : (
                    <span
                      className={mismatchCount(r) > 0 ? 'font-semibold text-red-700' : 'text-neutral-700'}
                      title={mismatchDetail(r)}
                    >
                      {mismatchCount(r)}
                    </span>
                  )}
                </td>
                <td className="max-w-xs space-y-1 text-[11px] text-neutral-600">
                  {r.data_verified != null && (
                    <span className={classNames(
                      'qa-badge',
                      r.data_verified ? 'bg-aicountly-100 text-aicountly-800' : 'bg-red-100 text-red-800',
                    )}>
                      {r.data_verified ? 'data verified' : 'data not verified'}
                    </span>
                  )}
                  <div>{r.verification_notes || '—'}</div>
                </td>
                <td className="space-x-2 whitespace-nowrap text-[11px]">
                  {(r.artifact_keys || []).length === 0 ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    (r.artifact_keys || []).map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="font-medium text-aicountly-700 hover:underline"
                        onClick={() => download(r.id, key, r.scenario_key)}
                      >
                        {key}
                      </button>
                    ))
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-4 text-xs text-neutral-500">
                  No file upload/download round-trips were recorded for this run.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function QaRunDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canDelete = hasRole(['Owner'])
  const canOperate = hasRole(['Owner', 'QA Manager'])

  const [tab, setTab] = useState('errors')
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  const [promptsUnavailable, setPromptsUnavailable] = useState(false)

  const run = useQuery({
    queryKey: ['run', id],
    queryFn: async () => (await api.get(v1(`/runs/${id}`))).data?.data,
    refetchInterval: (q) => {
      const sessions = q.state.data?.sessions || []
      const active = sessions.some((s) => ACTIVE_SESSION_STATUSES.includes(s.status))
        || ['pending', 'running'].includes(q.state.data?.status)
      return active ? 3000 : false
    },
  })

  const workerStatus = useQuery({
    queryKey: ['worker-status'],
    queryFn: async () => (await api.get(v1('/dashboard/worker-status'))).data?.data,
    refetchInterval: 10000,
  })

  const validations = useQuery({
    queryKey: ['validation', id],
    queryFn: async () => (await api.get(v1(`/validation-results?qa_run_id=${id}`))).data?.data ?? [],
    refetchInterval: () => (run.data?.status === 'running' ? 3000 : false),
  })

  const errors = useQuery({
    queryKey: ['run-errors', id],
    queryFn: async () => {
      const rows = (await api.get(v1('/error-register'), { params: { qa_run_id: id } })).data?.data ?? []
      return narrowToRun(rows, id)
    },
    refetchInterval: () => (run.data?.status === 'running' ? 5000 : false),
  })

  const reports = useQuery({
    queryKey: ['reports', id],
    queryFn: async () => (await api.get(v1(`/reports/${id}`))).data?.data ?? [],
    refetchInterval: () => (run.data?.status === 'running' ? 3000 : false),
  })

  // Returns null when the endpoint is not deployed yet, so the tab can be hidden.
  const fileIo = useQuery({
    queryKey: ['run-file-io', id],
    queryFn: async () => {
      try {
        const res = await api.get(v1(`/runs/${encodeURIComponent(id)}/file-io`))
        return Array.isArray(res.data?.data) ? res.data.data : []
      } catch (err) {
        const status = err?.response?.status
        if (status === 404 || status === 501) return null
        throw err
      }
    },
    retry: false,
    refetchInterval: () => (run.data?.status === 'running' ? 5000 : false),
  })

  const fileIoRows = fileIo.data
  const fileIoAvailable = fileIoRows !== null && !fileIo.isError

  const openReport = useMutation({
    mutationFn: async (path) => {
      const res = await api.get(path, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
  })

  const remove = useMutation({
    mutationFn: async () => api.delete(v1(`/runs/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      nav('/qa-runs')
    },
  })

  const cancel = useMutation({
    mutationFn: async () => api.post(v1(`/runs/${encodeURIComponent(id)}/cancel`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run', id] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['run-decisions', id] })
    },
  })

  const rerun = useMutation({
    mutationFn: async (sessionId) => api.post(v1(`/sessions/${sessionId}/rerun`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run', id] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['validation', id] })
      qc.invalidateQueries({ queryKey: ['run-errors', id] })
      qc.invalidateQueries({ queryKey: ['reports', id] })
      qc.invalidateQueries({ queryKey: ['sessions-for-plan'] })
    },
  })

  const deleteSession = useMutation({
    mutationFn: async (sessionId) => api.delete(v1(`/sessions/${sessionId}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run', id] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['validation', id] })
      qc.invalidateQueries({ queryKey: ['run-errors', id] })
      qc.invalidateQueries({ queryKey: ['run-file-io', id] })
      qc.invalidateQueries({ queryKey: ['reports', id] })
    },
  })

  async function copyPrompts(scope, key) {
    setCopyError('')
    setCopied('')
    try {
      const markdown = scope === 'run'
        ? await fetchRunPrompts(id)
        : await fetchSessionPrompts(scope)
      if (!markdown.trim()) {
        setCopyError('No developer prompts have been generated yet.')
        return
      }
      const ok = await copyText(markdown)
      if (!ok) {
        setCopyError('Could not write to the clipboard.')
        return
      }
      setCopied(key)
      setTimeout(() => setCopied(''), 2000)
    } catch (err) {
      if (err instanceof PromptsUnavailableError) {
        setPromptsUnavailable(true)
        return
      }
      setCopyError(err?.response?.data?.error || err?.message || 'Could not fetch developer prompts.')
    }
  }

  function handleDelete() {
    if (!window.confirm(
      `Delete QA run "${id}"?\n\nThis permanently removes sessions, plans, live logs, and all screenshots/report files from disk.`,
    )) return
    remove.mutate()
  }

  function handleCancel() {
    if (!window.confirm(
      'Cancel this QA run?\n\nQueued sessions are dropped and the worker stops after the session it is on. Results collected so far are kept.',
    )) return
    cancel.mutate()
  }

  function handleRerun(session) {
    if (!window.confirm(
      `Re-run “${session.name || 'this session'}”?\n\nPrior results, screenshots, and the live log for this session will be cleared, then the worker will pick it up again.`,
    )) return
    rerun.mutate(session.id)
  }

  function handleDeleteSession(session) {
    if (!window.confirm(
      `Delete session “${session.name || session.id}”?\n\nIts results, validation rows, live log and all evidence, screenshots and report files are removed from disk. This cannot be undone.`,
    )) return
    deleteSession.mutate(session.id)
  }

  if (run.isLoading) return <div className="text-sm text-neutral-500">Loading…</div>
  if (!run.data) return <div className="text-sm text-red-700">Run not found.</div>

  const r = run.data
  const sessions = r.sessions || []
  const queuedCount = sessions.filter((s) => s.status === 'queued').length
  const activeCount = sessions.filter((s) => ACTIVE_SESSION_STATUSES.includes(s.status)).length
  const awaitingDecision = sessions.some((s) => s.status === 'awaiting_decision')
  const pollDecisions = shouldPollDecisions([r.status, ...sessions.map((s) => s.status)]) || awaitingDecision
  const workerOnline = workerStatus.data?.online === true
  const profile = r.target_profile
  const missingCreds = profile && profile.has_credentials === false
  const finalReport = (reports.data || []).find((x) => x.kind === 'final')
  const cancellable = canOperate && CANCELLABLE_RUN_STATUSES.includes(r.status)
  const errorRows = errors.data || []
  const validationRows = validations.data || []
  const failedValidations = validationRows.filter((v) => !v.passed).length
  const visibleTabs = TABS.filter(([key]) => key !== 'file-io' || fileIoAvailable)
  const activeTab = visibleTabs.some(([key]) => key === tab) ? tab : 'errors'

  const tabCounts = {
    errors: errorRows.length,
    validations: failedValidations,
    'file-io': (fileIoRows || []).filter((x) => String(x.compare_status).toLowerCase() !== 'pass').length,
    evidence: sessions.length,
  }

  return (
    <div className="space-y-4">
      <div className="qa-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-neutral-900">{r.qa_run_id}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>{r.product_name}</span>
              <EnvBadge environment={r.environment} />
              <span>started {fmtDate(r.started_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`qa-badge ${workerOnline ? 'bg-aicountly-100 text-aicountly-800' : 'bg-neutral-100 text-neutral-600'}`}>
              Worker {workerOnline ? 'online' : 'offline'}
            </span>
            <StatusBadge status={r.status} />
            {finalReport && (
              <>
                <button
                  type="button"
                  className="qa-btn-secondary text-xs"
                  onClick={() => openReport.mutate(v1(`/reports/${id}/html`))}
                >Open HTML report</button>
                <button
                  type="button"
                  className="qa-btn-secondary text-xs"
                  onClick={() => openReport.mutate(v1(`/reports/${id}/json`))}
                >Open JSON</button>
              </>
            )}
            {!promptsUnavailable && (
              <button
                type="button"
                className="qa-btn-secondary text-xs"
                title="Copies the run-level developer fix prompts as markdown"
                onClick={() => copyPrompts('run', 'run')}
              >
                {copied === 'run' ? 'Prompts copied' : 'Copy developer prompts'}
              </button>
            )}
            {cancellable && (
              <button
                type="button"
                className="qa-btn-secondary text-xs"
                onClick={handleCancel}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? 'Cancelling…' : 'Cancel run'}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={remove.isPending}
                className="text-sm text-red-600 hover:underline disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {copyError && <p className="mt-2 text-xs text-amber-800">{copyError}</p>}
        {cancel.isError && (
          <p className="mt-2 text-xs text-red-700">
            Cancel failed. {cancel.error?.response?.data?.error || cancel.error?.message || 'Try again.'}
          </p>
        )}
        {deleteSession.isError && (
          <p className="mt-2 text-xs text-red-700">
            Delete session failed. {deleteSession.error?.response?.data?.error || deleteSession.error?.message || 'Try again.'}
          </p>
        )}

        {missingCreds && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p className="font-medium">Target credentials missing</p>
            <p className="mt-1 text-amber-900">
              The worker cannot log in until a password is saved for this target profile.{' '}
              <Link to={`/target-profiles/${profile.id}/edit`} className="font-medium text-aicountly-800 hover:underline">
                Edit target profile →
              </Link>
            </p>
          </div>
        )}
        {r.status === 'pending' && sessions.length === 0 && (
          <p className="mt-3 text-sm text-neutral-600">
            Waiting for session plan approval.{' '}
            <Link to={`/session-plans?qa_run_id=${encodeURIComponent(r.qa_run_id)}`} className="text-aicountly-700 hover:underline">
              Review and approve the session plan →
            </Link>
          </p>
        )}
        {r.status === 'running' && queuedCount > 0 && workerOnline && (
          <p className="mt-3 text-sm text-neutral-600">
            {queuedCount} session{queuedCount === 1 ? '' : 's'} queued. The QA worker is online and will claim the next session shortly.
          </p>
        )}
        {r.status === 'running' && activeCount > 0 && workerOnline && (
          <p className="mt-3 text-sm text-neutral-600">
            Status updates automatically every few seconds. Sessions with no worker progress for 15 minutes are marked failed.
          </p>
        )}
        {awaitingDecision && (
          <p className="mt-3 text-sm text-amber-900">
            A session is waiting for a human decision. Answer below (or on the session live log) to unblock the worker.
          </p>
        )}
        {activeCount > 0 && !workerOnline && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            <p className="font-medium">Note: QA worker is offline</p>
            <p className="mt-1 text-slate-700">
              Sessions stay queued until the dedicated Playwright worker{' '}
              <span className="font-mono text-xs">
                {workerStatus.data?.worker_id || 'aicountly-qa-worker'}
              </span>
              {' '}is running.
            </p>
            {workerStatus.data?.last_seen_at && (
              <p className="mt-1 text-xs text-slate-600">
                Last worker heartbeat: {fmtDate(workerStatus.data.last_seen_at)}
              </p>
            )}
          </div>
        )}
      </div>

      {pollDecisions && (
        <PendingDecisionCard qaRunId={r.qa_run_id || id} enabled={pollDecisions} />
      )}

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Session</th>
              <th>Module</th>
              <th>Status</th>
              <th>Issue / guidance</th>
              <th>Report</th>
              <th>Started</th>
              <th>Completed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const sum = s.result_summary
              const canOpenReport = sum?.has_report
              const showLive = ACTIVE_SESSION_STATUSES.includes(s.status)
              const canRerunRow = canOperate && ['completed', 'failed', 'skipped', 'partial', 'blocked_by_safe_guard'].includes(s.status)
              const locked = LOCKED_SESSION_STATUSES.includes(s.status)
              return (
                <tr key={s.id} id={`s-${s.id}`}>
                  <td>{s.order_index}</td>
                  <td>
                    <div className="font-medium text-neutral-900">{s.name}</div>
                    <div className="text-[11px] text-neutral-500">{s.template_code}</div>
                  </td>
                  <td>{s.module}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td><SessionIssue summary={sum} /></td>
                  <td>
                    {canOpenReport ? (
                      <button
                        type="button"
                        className="text-xs text-aicountly-700 hover:underline"
                        onClick={() => openReport.mutate(v1(`/reports/session/${s.id}/html`))}
                      >
                        HTML
                      </button>
                    ) : (
                      <span className="text-xs text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs">{fmtDate(s.started_at)}</td>
                  <td className="whitespace-nowrap text-xs">{fmtDate(s.completed_at)}</td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    <Link
                      to={`/sessions/${s.id}/log?name=${encodeURIComponent(s.name || '')}&from=${encodeURIComponent(`/qa-runs/${id}`)}&fromLabel=${encodeURIComponent('QA run')}`}
                      className={`text-xs font-medium hover:underline ${showLive ? 'text-aicountly-700' : 'text-neutral-600'}`}
                    >
                      View log
                    </Link>
                    {!promptsUnavailable && (
                      <button
                        type="button"
                        className="text-xs font-medium text-neutral-600 hover:underline"
                        title="Copy this session's developer fix prompts"
                        onClick={() => copyPrompts(s.id, `session-${s.id}`)}
                      >
                        {copied === `session-${s.id}` ? 'Copied' : 'Copy prompts'}
                      </button>
                    )}
                    {canRerunRow && (
                      <button
                        type="button"
                        className="text-xs font-medium text-amber-800 hover:underline disabled:opacity-50"
                        disabled={rerun.isPending}
                        onClick={() => handleRerun(s)}
                      >
                        {rerun.isPending && rerun.variables === s.id ? 'Re-queuing…' : 'Re-run'}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
                        disabled={locked || deleteSession.isPending}
                        title={locked
                          ? 'Wait until the worker finishes or the pending decision is answered'
                          : 'Delete this session and its evidence, screenshots and report files'}
                        onClick={() => handleDeleteSession(s)}
                      >
                        {deleteSession.isPending && deleteSession.variables === s.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {sessions.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-4 text-neutral-500">No sessions queued yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="qa-card p-0">
        <div className="flex flex-wrap items-center gap-4 border-b border-neutral-200 px-4 py-2">
          {visibleTabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={classNames(
                'text-sm',
                activeTab === key
                  ? 'font-semibold text-aicountly-700 underline'
                  : 'text-neutral-500 hover:text-neutral-800',
              )}
              onClick={() => setTab(key)}
            >
              {label}
              {tabCounts[key] > 0 && (
                <span className="ml-1 text-[11px] text-neutral-500">({tabCounts[key]})</span>
              )}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === 'errors' && (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">
                Errors rolled up for this run: failed workflows, blocked steps and failed checks, each with
                a plain-language summary and a copyable developer fix prompt.
              </p>
              <div className="overflow-x-auto">
                <table className="qa-table">
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Issue</th>
                      <th>Module</th>
                      <th>Status</th>
                      <th className="text-right">Count</th>
                      <th>Summary / fix prompt</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorRows.map((e) => (
                      <tr key={e.id}>
                        <td><SeverityBadge severity={e.severity} /></td>
                        <td className="max-w-xs">
                          <div className="font-mono text-xs font-semibold text-neutral-900">{e.title}</div>
                        </td>
                        <td className="text-xs">{e.module || '—'}</td>
                        <td><StatusBadge status={e.status || 'open'} /></td>
                        <td className="text-right text-xs tabular-nums">{e.count ?? 1}</td>
                        <td className="max-w-md space-y-1 text-xs text-neutral-700">
                          {e.human_summary || e.sample_message || '—'}
                          {e.developer_fix_prompt && (
                            <details className="rounded border border-neutral-200 bg-neutral-50">
                              <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium text-neutral-800">
                                Developer fix prompt
                              </summary>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-2 py-2 font-mono text-[11px] text-neutral-800">
                                {e.developer_fix_prompt}
                              </pre>
                            </details>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-right text-xs">
                          {e.last_session_id ? (
                            <a href={`#s-${e.last_session_id}`} className="text-aicountly-700 hover:underline">
                              Session
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {!errors.isLoading && errorRows.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-4 text-xs text-neutral-500">No errors recorded for this run.</td></tr>
                    )}
                    {errors.isLoading && (
                      <tr><td colSpan={7} className="px-3 py-4 text-xs text-neutral-500">Loading…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Link to={`/error-register?qa_run_id=${encodeURIComponent(id)}`} className="text-xs text-aicountly-700 hover:underline">
                Open full error register →
              </Link>
            </div>
          )}

          {activeTab === 'validations' && (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">
                Data-correctness checks: what QA expected versus what the app actually stored or reported.
              </p>
              <div className="overflow-x-auto">
                <table className="qa-table">
                  <thead>
                    <tr><th>Rule</th><th>Severity</th><th>Result</th><th>Expected</th><th>Actual</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {validationRows.slice(0, 200).map((v) => (
                      <tr key={v.id}>
                        <td className="font-mono text-xs">{v.rule_code}</td>
                        <td><SeverityBadge severity={v.severity} /></td>
                        <td>
                          {v.passed
                            ? <span className="qa-badge bg-aicountly-100 text-aicountly-800">pass</span>
                            : <span className="qa-badge bg-red-100 text-red-800">fail</span>}
                        </td>
                        <td className="text-xs">{v.expected ?? '—'}</td>
                        <td className="text-xs">{v.actual ?? '—'}</td>
                        <td className="text-xs">{v.notes ?? '—'}</td>
                      </tr>
                    ))}
                    {validationRows.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-4 text-xs text-neutral-500">No validation results yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'file-io' && fileIoAvailable && (
            <FileIoTable qaRunId={id} rows={fileIoRows || []} />
          )}

          {activeTab === 'evidence' && (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">
                Screenshots, step traces and captured responses live on each session live log — including
                the exact screen where an error occurred.
              </p>
              <ul className="divide-y divide-neutral-100">
                {sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-900">
                        {s.order_index}. {s.name}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {s.module || '—'} · <StatusBadge status={s.status} />
                      </div>
                    </div>
                    <Link
                      to={`/sessions/${s.id}/log?name=${encodeURIComponent(s.name || '')}&from=${encodeURIComponent(`/qa-runs/${id}`)}&fromLabel=${encodeURIComponent('QA run')}`}
                      className="qa-btn-secondary text-xs"
                    >
                      Open evidence &amp; screenshots
                    </Link>
                  </li>
                ))}
                {sessions.length === 0 && (
                  <li className="py-3 text-xs text-neutral-500">No sessions have run yet, so there is no evidence to review.</li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
