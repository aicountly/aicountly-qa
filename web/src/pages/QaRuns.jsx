import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, StatusBadge } from '../components/Badges.jsx'
import { fmtDate } from '../lib/format.js'
import FilterBar from '../components/FilterBar.jsx'
import { PRODUCT_FILTER_OPTIONS } from '../lib/products.js'
import { useAuth } from '../lib/auth.jsx'
const envs = ['sandbox', 'gh', 'prod_basic', 'prod_full']
const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled']

export default function QaRuns() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canDelete = hasRole(['Owner'])
  const [filters, setFilters] = useState({})
  const params = new URLSearchParams(filters).toString()

  const { data, isLoading } = useQuery({
    queryKey: ['runs', params],
    queryFn: async () => (await api.get(v1(`/runs?${params}`))).data?.data ?? [],
  })

  const remove = useMutation({
    mutationFn: async (qaRunId) => api.delete(v1(`/runs/${qaRunId}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })

  function handleDelete(run) {
    if (!window.confirm(`Delete QA run "${run.qa_run_id}"? This removes its sessions and plans.`)) {
      return
    }
    remove.mutate(run.qa_run_id)
  }

  return (
    <div className="space-y-4">
      <FilterBar
        values={filters}
        onChange={setFilters}
        fields={[
          { key: 'product',     label: 'Product',     options: PRODUCT_FILTER_OPTIONS },
          { key: 'environment', label: 'Environment', options: envs.map((e) => ({ value: e, label: e })) },
          { key: 'status',      label: 'Status',      options: statuses.map((s) => ({ value: s, label: s })) },
          { key: 'from',        label: 'From',        type: 'date' },
          { key: 'to',          label: 'To',          type: 'date' },
        ]}
      />

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr><th>QA Run</th><th>Product</th><th>Environment</th><th>Status</th><th>Started</th><th>Completed</th>{canDelete && <th></th>}</tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={canDelete ? 7 : 6} className="px-3 py-4 text-neutral-500">Loading…</td></tr>}
            {(data || []).map((r) => (
              <tr key={r.qa_run_id}>
                <td><Link className="text-aicountly-700 hover:underline" to={`/qa-runs/${r.qa_run_id}`}>{r.qa_run_id}</Link></td>
                <td>{r.product_name}</td>
                <td><EnvBadge environment={r.environment} /></td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-xs">{fmtDate(r.started_at)}</td>
                <td className="text-xs">{fmtDate(r.completed_at)}</td>
                {canDelete && (
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(r)}
                      disabled={remove.isPending}
                      className="text-red-600 hover:underline text-sm disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && (data || []).length === 0 && (
              <tr><td colSpan={canDelete ? 7 : 6} className="px-3 py-4 text-neutral-500">No QA runs match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
