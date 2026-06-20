import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { fmtRelative, envLabel } from '../lib/format.js'
import { EnvBadge, StatusBadge } from '../components/Badges.jsx'

function Card({ k, v, accent, to }) {
  const body = (
    <div className={`qa-card ${accent || ''}`}>
      <div className="text-2xl font-bold text-neutral-900">{k}</div>
      <div className="text-xs text-neutral-500">{v}</div>
    </div>
  )
  return to ? <Link to={to} className="block">{body}</Link> : body
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get(v1('/dashboard/summary'))).data?.data,
  })

  const cards = data?.cards || {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card k={cards.total_runs ?? '—'}      v="Total QA Runs"      to="/qa-runs" />
        <Card k={cards.passed_sessions ?? '—'} v="Passed Sessions"    accent="border-aicountly-200" />
        <Card k={cards.failed_sessions ?? '—'} v="Failed Sessions"    accent="border-red-200" to="/error-register" />
        <Card k={cards.critical_issues ?? '—'} v="Critical Issues"    accent="border-red-300" to="/error-register" />
        <Card k={cards.high_issues ?? '—'}     v="High Priority"      accent="border-amber-200" to="/error-register" />
        <Card
          k={cards.last_run ? cards.last_run.qa_run_id : '—'}
          v={cards.last_run ? `Last run · ${fmtRelative(cards.last_run.created_at)}` : 'No runs yet'}
          to={cards.last_run ? `/qa-runs/${cards.last_run.qa_run_id}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="qa-card lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Target App Health</h2>
            <Link to="/target-profiles" className="text-xs text-aicountly-700 hover:underline">Manage</Link>
          </div>
          <table className="qa-table">
            <thead>
              <tr>
                <th>Profile</th><th>Product</th><th>Env</th><th>Last status</th><th>When</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="text-neutral-500">Loading…</td></tr>}
              {(data?.target_health || []).map((t) => (
                <tr key={t.id}>
                  <td>{t.profile_name}</td>
                  <td>{t.product_name}</td>
                  <td><EnvBadge environment={t.environment} /></td>
                  <td>{t.status ? <StatusBadge status={t.status} /> : <span className="text-neutral-400 text-xs">no runs</span>}</td>
                  <td className="text-xs text-neutral-500">{fmtRelative(t.completed_at)}</td>
                </tr>
              ))}
              {!isLoading && (data?.target_health || []).length === 0 && (
                <tr><td colSpan={5} className="text-neutral-500">No target profiles yet. <Link to="/target-profiles/new" className="text-aicountly-700">Create one →</Link></td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="qa-card">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Module-wise Failures</h2>
          <ul className="space-y-1.5 text-sm">
            {(data?.module_failures || []).map((m) => (
              <li key={m.module || 'unknown'} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-1.5">
                <span className="text-neutral-700">{m.module || 'Unknown'}</span>
                <span className="text-red-700 font-semibold">{m.failed}</span>
              </li>
            ))}
            {(data?.module_failures || []).length === 0 && (
              <li className="text-xs text-neutral-500">No failures recorded yet.</li>
            )}
          </ul>
        </section>
      </div>

      <section className="qa-card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Recent QA Reports</h2>
          <Link to="/qa-reports" className="text-xs text-aicountly-700 hover:underline">View all</Link>
        </div>
        <table className="qa-table">
          <thead>
            <tr><th>QA Run</th><th>Kind</th><th>Product</th><th>Generated</th></tr>
          </thead>
          <tbody>
            {(data?.recent_reports || []).map((r) => (
              <tr key={r.id}>
                <td><Link to={`/qa-runs/${r.qa_run_id}`} className="text-aicountly-700 hover:underline">{r.qa_run_id}</Link></td>
                <td><span className="qa-badge bg-neutral-100 text-neutral-700">{r.kind}</span></td>
                <td>{r.product_name}</td>
                <td className="text-xs text-neutral-500">{fmtRelative(r.generated_at)}</td>
              </tr>
            ))}
            {(data?.recent_reports || []).length === 0 && (
              <tr><td colSpan={4} className="text-xs text-neutral-500">No reports generated yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
