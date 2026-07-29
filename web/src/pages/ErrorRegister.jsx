import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { SeverityBadge, StatusBadge } from '../components/Badges.jsx'
import { fmtDate } from '../lib/format.js'
import FilterBar from '../components/FilterBar.jsx'
import { PRODUCT_FILTER_OPTIONS } from '../lib/products.js'
import { useAuth } from '../lib/auth.jsx'

const severities = ['critical', 'high', 'medium', 'low', 'warning']
const statuses = ['open', 'investigating', 'closed']

function shortText(text, max = 120) {
  const s = String(text || '').trim()
  if (!s) return ''
  if (s.length <= max) return s
  return `${s.slice(0, max).trim()}…`
}

function ruleFromTitle(title) {
  const t = String(title || '')
  const m = t.match(/^Failed:\s*(.+)$/i)
  return (m ? m[1] : t).trim()
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      className="shrink-0 rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
      onClick={handleCopy}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function ErrorRowDetail({ error }) {
  const humanSummary = error.human_summary || ''
  const fixPrompt = error.developer_fix_prompt || ''
  const guidance = error.suggested_developer_area || error.sample_message || ''

  if (!humanSummary && !fixPrompt && !guidance) {
    return <span className="text-neutral-400">—</span>
  }

  return (
    <div className="max-w-md space-y-2 text-xs text-neutral-600">
      {humanSummary ? (
        <p className="text-neutral-800">{humanSummary}</p>
      ) : guidance ? (
        <p title={guidance}>{shortText(guidance, 100)}</p>
      ) : null}

      {fixPrompt ? (
        <details className="rounded-md border border-neutral-200 bg-neutral-50">
          <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] font-medium text-neutral-800">
            Developer fix prompt
          </summary>
          <div className="border-t border-neutral-200 px-2 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-neutral-500">Copy into Cursor / IDE</span>
              <CopyButton text={fixPrompt} />
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-neutral-800">
              {fixPrompt}
            </pre>
          </div>
        </details>
      ) : null}

      {!humanSummary && !fixPrompt && guidance && guidance.length > 100 ? (
        <span className="text-neutral-500" title={guidance}>{shortText(guidance, 100)}</span>
      ) : null}
    </div>
  )
}

export default function ErrorRegister() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canUpdate = hasRole(['Owner', 'QA Manager'])
  const [filters, setFilters] = useState({ status: 'open' })
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== '')),
  ).toString()

  const { data, isLoading } = useQuery({
    queryKey: ['errors', params],
    queryFn: async () => (await api.get(v1(`/error-register?${params}`))).data?.data ?? [],
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }) => api.patch(v1(`/error-register/${id}`), { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['errors'] }),
  })

  return (
    <div className="space-y-4">
      <div className="qa-card">
        <h2 className="text-sm font-semibold text-neutral-900">What is the Error Register?</h2>
        <p className="mt-1 text-sm text-neutral-600">
          A rolled-up list of <strong>failed validation rules</strong> from QA runs. The same failure
          (same rule + expected/actual signature) increments <strong>Count</strong> instead of creating
          a new row — so developers can see recurring issues across runs.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Tip: older Login rows may list many accounting rules from early full-catalogue runs. Prefer
          filtering by <span className="font-medium">open</span> status and the latest Last Seen date.
          Use <strong>Open run</strong> / <strong>View log</strong> for screenshots and step detail.
          Newer rows may include a human summary and a copyable developer fix prompt.
        </p>
      </div>

      <FilterBar
        values={filters}
        onChange={setFilters}
        fields={[
          { key: 'severity', label: 'Severity', options: severities.map((s) => ({ value: s, label: s })) },
          { key: 'product', label: 'Product', options: PRODUCT_FILTER_OPTIONS },
          { key: 'status', label: 'Status', options: statuses.map((s) => ({ value: s, label: s })) },
        ]}
      />

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Issue</th>
              <th>Product / Module</th>
              <th>Status</th>
              <th className="text-right">Count</th>
              <th>Last seen</th>
              <th>Guidance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-neutral-500">Loading…</td>
              </tr>
            )}
            {(data || []).map((e) => {
              const rule = ruleFromTitle(e.title)
              return (
                <tr key={e.id}>
                  <td><SeverityBadge severity={e.severity} /></td>
                  <td className="min-w-[12rem] max-w-xs">
                    <div className="font-mono text-xs font-semibold text-neutral-900">{rule || e.title}</div>
                    {e.human_summary ? (
                      <div className="mt-0.5 text-xs text-neutral-700" title={e.human_summary}>
                        {shortText(e.human_summary, 90)}
                      </div>
                    ) : e.sample_message ? (
                      <div className="mt-0.5 text-xs text-neutral-600" title={e.sample_message}>
                        {shortText(e.sample_message, 90)}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-[11px] text-neutral-400">Failed validation</div>
                    )}
                  </td>
                  <td className="text-xs">
                    <div className="font-medium text-neutral-800">{e.product_name || '—'}</div>
                    <div className="text-neutral-500">{e.module || '—'}</div>
                  </td>
                  <td>
                    {canUpdate ? (
                      <select
                        className="qa-input py-1 text-xs"
                        value={e.status || 'open'}
                        disabled={setStatus.isPending}
                        onChange={(ev) => setStatus.mutate({ id: e.id, status: ev.target.value })}
                      >
                        {statuses.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={e.status || 'open'} />
                    )}
                  </td>
                  <td className="text-right font-medium tabular-nums">{e.count}</td>
                  <td className="whitespace-nowrap text-xs">
                    <div>{fmtDate(e.last_seen_at)}</div>
                    {e.last_seen_run_id && (
                      <div className="text-[11px] text-neutral-500">{e.last_seen_run_id}</div>
                    )}
                  </td>
                  <td>
                    <ErrorRowDetail error={e} />
                  </td>
                  <td className="space-x-2 whitespace-nowrap text-right text-xs">
                    {e.last_seen_run_id ? (
                      <Link
                        to={`/qa-runs/${encodeURIComponent(e.last_seen_run_id)}`}
                        className="font-medium text-aicountly-700 hover:underline"
                      >
                        Open run
                      </Link>
                    ) : null}
                    {e.last_session_id && e.last_seen_run_id ? (
                      <Link
                        to={`/qa-runs/${encodeURIComponent(e.last_seen_run_id)}#s-${e.last_session_id}`}
                        className="font-medium text-neutral-600 hover:underline"
                      >
                        Session
                      </Link>
                    ) : null}
                  </td>
                </tr>
              )
            })}
            {!isLoading && (data || []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-neutral-500">
                  No errors match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
