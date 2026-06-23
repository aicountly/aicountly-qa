import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, SeverityBadge, StatusBadge } from '../components/Badges.jsx'
import { fmtDate } from '../lib/format.js'
import { useAuth } from '../lib/auth.jsx'

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

function SessionIssue({ summary }) {
  if (!summary) return <span className="text-xs text-neutral-400">—</span>

  const fatal = humanizeFatalError(summary.fatal_error)
  const showPrompt = summary.suggested_prompt && !fatal

  return (
    <div className="max-w-md space-y-1">
      {fatal && (
        <p className="text-xs font-medium text-red-800">{fatal}</p>
      )}
      {!fatal && summary.suggested_area && (
        <p className="text-xs text-amber-900">{summary.suggested_area}</p>
      )}
      {showPrompt && (
        <p className="text-xs text-neutral-600 line-clamp-3" title={summary.suggested_prompt}>
          {summary.suggested_prompt}
        </p>
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

export default function QaRunDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canDelete = hasRole(['Owner'])

  const run = useQuery({
    queryKey: ['run', id],
    queryFn: async () => (await api.get(v1(`/runs/${id}`))).data?.data,
    refetchInterval: (q) => {
      const sessions = q.state.data?.sessions || []
      const active = sessions.some((s) => ['queued', 'claimed', 'running'].includes(s.status))
      return active ? 5000 : false
    },
  })

  const workerStatus = useQuery({
    queryKey: ['worker-status'],
    queryFn: async () => (await api.get(v1('/dashboard/worker-status'))).data?.data,
    refetchInterval: 15000,
  })

  const validations = useQuery({
    queryKey: ['validation', id],
    queryFn: async () => (await api.get(v1(`/validation-results?qa_run_id=${id}`))).data?.data ?? [],
  })

  const reports = useQuery({
    queryKey: ['reports', id],
    queryFn: async () => (await api.get(v1(`/reports/${id}`))).data?.data ?? [],
  })

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

  function handleDelete() {
    if (!window.confirm(`Delete QA run "${id}"? This removes its sessions and plans.`)) {
      return
    }
    remove.mutate()
  }

  if (run.isLoading) return <div className="text-sm text-neutral-500">Loading…</div>
  if (!run.data) return <div className="text-sm text-red-700">Run not found.</div>

  const r = run.data
  const sessions = r.sessions || []
  const queuedCount = sessions.filter((s) => s.status === 'queued').length
  const activeCount = sessions.filter((s) => ['queued', 'claimed', 'running'].includes(s.status)).length
  const workerOnline = workerStatus.data?.online === true
  const profile = r.target_profile
  const missingCreds = profile && profile.has_credentials === false
  const finalReport = (reports.data || []).find((x) => x.kind === 'final')

  return (
    <div className="space-y-4">
      <div className="qa-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-neutral-900">{r.qa_run_id}</div>
            <div className="text-xs text-neutral-500">
              {r.product_name} · <EnvBadge environment={r.environment} /> · started {fmtDate(r.started_at)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`qa-badge ${workerOnline ? 'bg-aicountly-100 text-aicountly-800' : 'bg-neutral-100 text-neutral-600'}`}>
              Worker {workerOnline ? 'online' : 'offline'}
            </span>
            <StatusBadge status={r.status} />
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={remove.isPending}
                className="text-red-600 hover:underline text-sm disabled:opacity-50"
              >
                Delete
              </button>
            )}
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
          </div>
        </div>
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
        {activeCount > 0 && !workerOnline && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            <p className="font-medium">QA worker is not running</p>
            <p className="mt-1 text-red-800">
              Sessions stay in <span className="font-mono text-xs">queued</span> until the Playwright worker on{' '}
              <span className="font-mono text-xs">worker.apis.aicountly.com</span> polls the API.
            </p>
            {workerStatus.data?.last_seen_at && (
              <p className="mt-1 text-xs text-red-700">
                Last worker heartbeat: {fmtDate(workerStatus.data.last_seen_at)}
              </p>
            )}
          </div>
        )}
      </div>

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
            </tr>
          </thead>
          <tbody>
            {(r.sessions || []).map((s) => {
              const sum = s.result_summary
              const canOpenReport = sum?.has_report
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
                  <td className="text-xs whitespace-nowrap">{fmtDate(s.started_at)}</td>
                  <td className="text-xs whitespace-nowrap">{fmtDate(s.completed_at)}</td>
                </tr>
              )
            })}
            {(r.sessions || []).length === 0 && (
              <tr><td colSpan={8} className="px-3 py-4 text-neutral-500">No sessions queued yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="qa-card">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Validation Results</h2>
        <table className="qa-table">
          <thead>
            <tr><th>Rule</th><th>Severity</th><th>Result</th><th>Expected</th><th>Actual</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {(validations.data || []).slice(0, 100).map((v) => (
              <tr key={v.id}>
                <td className="font-mono text-xs">{v.rule_code}</td>
                <td><SeverityBadge severity={v.severity} /></td>
                <td>{v.passed ? <span className="qa-badge bg-aicountly-100 text-aicountly-800">pass</span> : <span className="qa-badge bg-red-100 text-red-800">fail</span>}</td>
                <td className="text-xs">{v.expected ?? '—'}</td>
                <td className="text-xs">{v.actual ?? '—'}</td>
                <td className="text-xs">{v.notes ?? '—'}</td>
              </tr>
            ))}
            {(validations.data || []).length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-xs text-neutral-500">No validation results yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
