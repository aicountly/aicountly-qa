import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, SeverityBadge, StatusBadge } from '../components/Badges.jsx'
import { fmtDate } from '../lib/format.js'

export default function QaRunDetail() {
  const { id } = useParams()

  const run = useQuery({
    queryKey: ['run', id],
    queryFn: async () => (await api.get(v1(`/runs/${id}`))).data?.data,
  })

  const validations = useQuery({
    queryKey: ['validation', id],
    queryFn: async () => (await api.get(v1(`/validation-results?qa_run_id=${id}`))).data?.data ?? [],
  })

  const reports = useQuery({
    queryKey: ['reports', id],
    queryFn: async () => (await api.get(v1(`/reports/${id}`))).data?.data ?? [],
  })

  if (run.isLoading) return <div className="text-sm text-neutral-500">Loading…</div>
  if (!run.data) return <div className="text-sm text-red-700">Run not found.</div>

  const r = run.data
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
          <div className="flex items-center gap-2">
            <StatusBadge status={r.status} />
            {finalReport && (
              <>
                <a
                  className="qa-btn-secondary text-xs"
                  href={`${import.meta.env.VITE_API_URL || '/api'}/v1/reports/${id}/html`}
                  target="_blank" rel="noreferrer"
                >Open HTML report</a>
                <a
                  className="qa-btn-secondary text-xs"
                  href={`${import.meta.env.VITE_API_URL || '/api'}/v1/reports/${id}/json`}
                  target="_blank" rel="noreferrer"
                >Open JSON</a>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr><th>#</th><th>Session</th><th>Module</th><th>Sub-module</th><th>Status</th><th>Started</th><th>Completed</th></tr>
          </thead>
          <tbody>
            {(r.sessions || []).map((s) => (
              <tr key={s.id}>
                <td>{s.order_index}</td>
                <td>
                  <Link to={`/qa-runs/${id}#s-${s.id}`} className="text-aicountly-700 hover:underline">{s.name}</Link>
                  <div className="text-[11px] text-neutral-500">{s.template_code}</div>
                </td>
                <td>{s.module}</td>
                <td>{s.sub_module || '—'}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="text-xs">{fmtDate(s.started_at)}</td>
                <td className="text-xs">{fmtDate(s.completed_at)}</td>
              </tr>
            ))}
            {(r.sessions || []).length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-neutral-500">No sessions queued yet.</td></tr>
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
