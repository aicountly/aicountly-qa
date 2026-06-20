import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { SeverityBadge } from '../components/Badges.jsx'
import { fmtDate } from '../lib/format.js'
import FilterBar from '../components/FilterBar.jsx'

const severities = ['critical', 'high', 'medium', 'low', 'warning']
const statuses = ['open', 'investigating', 'closed']

export default function ErrorRegister() {
  const [filters, setFilters] = useState({})
  const params = new URLSearchParams(filters).toString()
  const { data, isLoading } = useQuery({
    queryKey: ['errors', params],
    queryFn: async () => (await api.get(v1(`/error-register?${params}`))).data?.data ?? [],
  })

  return (
    <div className="space-y-4">
      <FilterBar
        values={filters}
        onChange={setFilters}
        fields={[
          { key: 'severity', label: 'Severity', options: severities.map((s) => ({ value: s, label: s })) },
          { key: 'product',  label: 'Product',  options: ['books', 'gh-books', 'sandbox', 'my', 'manage', 'auditor', 'fr', 'secretarial', 'hrms'].map((p) => ({ value: p, label: p })) },
          { key: 'status',   label: 'Status',   options: statuses.map((s) => ({ value: s, label: s })) },
        ]}
      />

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr><th>Severity</th><th>Title</th><th>Product</th><th>Module</th><th>Count</th><th>Last Seen</th><th>Suggested Area</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-3 py-4 text-neutral-500">Loading…</td></tr>}
            {(data || []).map((e) => (
              <tr key={e.id}>
                <td><SeverityBadge severity={e.severity} /></td>
                <td className="font-medium text-neutral-900">{e.title}</td>
                <td>{e.product_name}</td>
                <td>{e.module}</td>
                <td className="text-right">{e.count}</td>
                <td className="text-xs">{fmtDate(e.last_seen_at)}</td>
                <td className="text-xs text-neutral-600">{e.suggested_developer_area}</td>
              </tr>
            ))}
            {!isLoading && (data || []).length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-neutral-500">No errors recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
