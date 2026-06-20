import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import FilterBar from '../components/FilterBar.jsx'
import { PRODUCT_FILTER_OPTIONS } from '../lib/products.js'
import { Link } from 'react-router-dom'

export default function QaReports() {
  const [filters, setFilters] = useState({ kind: 'final' })
  const params = new URLSearchParams(filters).toString()
  const { data, isLoading } = useQuery({
    queryKey: ['qa-reports', params],
    queryFn: async () => (await api.get(v1(`/reports?${params}`))).data?.data ?? [],
  })

  return (
    <div className="space-y-4">
      <FilterBar
        values={filters}
        onChange={setFilters}
        fields={[
          { key: 'qa_run_id', label: 'QA Run ID', placeholder: 'QA-RUN-…' },
          { key: 'product',   label: 'Product', options: PRODUCT_FILTER_OPTIONS },
          { key: 'kind',      label: 'Kind', options: [{ value: 'session', label: 'session' }, { value: 'final', label: 'final' }] },
        ]}
      />

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr><th>QA Run</th><th>Kind</th><th>Product</th><th>Generated</th><th>HTML</th><th>JSON</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-4 text-neutral-500">Loading…</td></tr>}
            {(data || []).map((r) => (
              <tr key={r.id}>
                <td><Link to={`/qa-runs/${r.qa_run_id}`} className="text-aicountly-700 hover:underline">{r.qa_run_id}</Link></td>
                <td><span className="qa-badge bg-neutral-100 text-neutral-700">{r.kind}</span></td>
                <td>{r.product_name}</td>
                <td className="text-xs">{fmtDate(r.generated_at)}</td>
                <td><a className="text-aicountly-700 hover:underline text-xs" href={`${import.meta.env.VITE_API_URL || '/api'}/v1/reports/${r.qa_run_id}/html`} target="_blank" rel="noreferrer">Open</a></td>
                <td><a className="text-aicountly-700 hover:underline text-xs" href={`${import.meta.env.VITE_API_URL || '/api'}/v1/reports/${r.qa_run_id}/json`} target="_blank" rel="noreferrer">Open</a></td>
              </tr>
            ))}
            {!isLoading && (data || []).length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-neutral-500">No reports match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
