import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, StatusBadge } from '../components/Badges.jsx'
import { fmtDate } from '../lib/format.js'

export default function SessionPlans() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const qaRunId = sp.get('qa_run_id') || ''

  const { data, isLoading } = useQuery({
    queryKey: ['session-plans'],
    queryFn: async () => (await api.get(v1('/session-plans'))).data?.data ?? [],
  })

  // Legacy deep-link: /session-plans?qa_run_id=… → open matching plan detail
  useEffect(() => {
    if (!qaRunId || !data?.length) return
    const match = data.find((p) => p.qa_run_id === qaRunId)
    if (match) nav(`/session-plans/${match.id}`, { replace: true })
  }, [qaRunId, data, nav])

  const rows = data || []

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Review generated session plans. Open a plan to edit, approve, or monitor module execution.
      </p>

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr>
              <th>QA Run</th>
              <th>Product</th>
              <th>Environment</th>
              <th>Sessions</th>
              <th>Status</th>
              <th>Generated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-3 py-4 text-sm text-neutral-500">Loading…</td></tr>
            )}
            {rows.map((plan) => {
              const parsed = typeof plan.plan_json === 'string'
                ? (() => { try { return JSON.parse(plan.plan_json) } catch { return {} } })()
                : (plan.plan_json || {})
              const sessionCount = (parsed.sessions || []).length
              return (
                <tr key={plan.id}>
                  <td className="font-medium text-neutral-900">{plan.qa_run_id}</td>
                  <td>{parsed.product || '—'}</td>
                  <td>{parsed.environment ? <EnvBadge environment={parsed.environment} /> : '—'}</td>
                  <td>{sessionCount}</td>
                  <td><StatusBadge status={plan.status} /></td>
                  <td className="text-xs whitespace-nowrap">{fmtDate(parsed.generated_at || plan.created_at)}</td>
                  <td className="text-right">
                    <Link
                      to={`/session-plans/${plan.id}`}
                      className="text-sm font-medium text-aicountly-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              )
            })}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-sm text-neutral-500">
                  No session plans yet.{' '}
                  <Link to="/new-qa-run" className="text-aicountly-700 hover:underline">Start a new QA run →</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
