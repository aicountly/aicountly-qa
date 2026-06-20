import { useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { SeverityBadge } from '../components/Badges.jsx'

export default function ValidationRules() {
  const { data, isLoading } = useQuery({
    queryKey: ['validation-rules'],
    queryFn: async () => (await api.get(v1('/validation-rules'))).data?.data ?? [],
  })

  const grouped = (data || []).reduce((acc, r) => {
    acc[r.rule_kind] = acc[r.rule_kind] || []
    acc[r.rule_kind].push(r)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Built-in accounting, report, UI and workflow checks. Failed rules raise issues on the Error Register with the configured severity.
      </p>
      {isLoading && <div className="text-sm text-neutral-500">Loading…</div>}
      {Object.entries(grouped).map(([kind, rows]) => (
        <section key={kind} className="qa-card overflow-x-auto p-0">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-aicountly-700 border-b border-aicountly-100 bg-aicountly-50">
            {kind} ({rows.length})
          </div>
          <table className="qa-table">
            <thead>
              <tr><th>Code</th><th>Title</th><th>Severity on fail</th><th>Product</th><th>Description</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.rule_code}</td>
                  <td>{r.title}</td>
                  <td><SeverityBadge severity={r.severity_on_fail} /></td>
                  <td>{r.product_name || <span className="text-neutral-400">all</span>}</td>
                  <td className="text-xs text-neutral-600">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
