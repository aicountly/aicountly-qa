import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import FilterBar from '../components/FilterBar.jsx'

const events = [
  'login', 'logout',
  'target_profile_create', 'target_profile_update', 'target_profile_delete',
  'credential_change', 'credential_clear',
  'master_prompt_submit', 'session_plan_generated', 'session_plan_update', 'session_approval',
  'session_execution_start', 'session_execution_complete',
  'target_app_login_credentials_fetched', 'screenshot_captured',
  'report_viewed', 'settings_update',
]

export default function AuditLogs() {
  const [filters, setFilters] = useState({})
  const params = new URLSearchParams(filters).toString()

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: async () => (await api.get(v1(`/audit-logs?${params}`))).data?.data ?? [],
  })

  return (
    <div className="space-y-4">
      <FilterBar
        values={filters}
        onChange={setFilters}
        fields={[
          { key: 'event',     label: 'Event',    options: events.map((e) => ({ value: e, label: e })) },
          { key: 'qa_run_id', label: 'QA Run',   placeholder: 'QA-RUN-…' },
          { key: 'actor_id',  label: 'Actor ID', type: 'number' },
          { key: 'from',      label: 'From',     type: 'date' },
          { key: 'to',        label: 'To',       type: 'date' },
        ]}
      />

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr><th>Time</th><th>Event</th><th>Actor</th><th>QA Run</th><th>Subject</th><th>IP</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-4 text-neutral-500">Loading…</td></tr>}
            {(data || []).map((row) => (
              <tr key={row.id}>
                <td className="text-xs">{fmtDate(row.created_at)}</td>
                <td className="font-mono text-xs">{row.event}</td>
                <td className="text-xs">{row.actor_email || row.actor_id || '—'}</td>
                <td className="text-xs">{row.qa_run_id || '—'}</td>
                <td className="text-xs">{row.subject_kind ? `${row.subject_kind}#${row.subject_id}` : '—'}</td>
                <td className="text-xs">{row.ip_address || '—'}</td>
              </tr>
            ))}
            {!isLoading && (data || []).length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-neutral-500">No audit entries match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
