import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'
import { classNames, fmtDate } from '../lib/format.js'
import FilterBar from '../components/FilterBar.jsx'
import { PRODUCT_FILTER_OPTIONS, productLabel } from '../lib/products.js'
import { EnvBadge } from '../components/Badges.jsx'
import { copyText } from '../lib/clipboard.js'
import {
  PromptsUnavailableError,
  fetchRunPrompts,
  fetchSessionPrompts,
  openTextBlob,
  slugify,
} from '../lib/prompts.js'

function isSessionReport(report) {
  return String(report?.kind || '') === 'session' && Number(report?.session_id || 0) > 0
}

/** Session rows must resolve to session-scoped files, not the run-level report. */
function reportPaths(report) {
  if (!report) return null
  if (isSessionReport(report)) {
    return {
      html: v1(`/reports/session/${report.session_id}/html`),
      json: v1(`/reports/session/${report.session_id}/json`),
    }
  }
  const runId = encodeURIComponent(String(report.qa_run_id || ''))
  if (!runId) return null
  return {
    html: v1(`/reports/${runId}/html`),
    json: v1(`/reports/${runId}/json`),
  }
}

export default function QaReports() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState({ kind: 'final' })
  const [activeId, setActiveId] = useState(() => {
    const fromUrl = Number(searchParams.get('id') || 0)
    return fromUrl > 0 ? fromUrl : null
  })
  const [actionMsg, setActionMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [promptsUnavailable, setPromptsUnavailable] = useState(false)

  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && String(v).trim() !== '')),
  ).toString()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['qa-reports', params],
    queryFn: async () => (await api.get(v1(`/reports?${params}`))).data?.data ?? [],
  })

  const reports = data || []
  const active = reports.find((r) => r.id === activeId) || null
  const paths = reportPaths(active)

  useEffect(() => {
    if (active) return
    setActiveId(reports[0]?.id ?? null)
  }, [reports, active])

  const html = useQuery({
    queryKey: ['qa-report-html', active?.id],
    queryFn: async () => (await api.get(paths.html, { responseType: 'text' })).data,
    enabled: !!active && !!paths?.html,
    retry: false,
  })

  function selectReport(id) {
    setActiveId(id)
    setSearchParams({ id: String(id) }, { replace: true })
    setActionMsg('')
    setCopied(false)
  }

  async function openBlob(path) {
    setActionMsg('')
    try {
      const res = await api.get(path, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setActionMsg(err?.response?.status === 404
        ? 'The report file is missing on the server.'
        : err?.message || 'Could not open the report.')
    }
  }

  async function loadPrompts() {
    if (!active) return null
    return isSessionReport(active)
      ? fetchSessionPrompts(active.session_id)
      : fetchRunPrompts(active.qa_run_id)
  }

  async function handleCopyPrompts() {
    setActionMsg('')
    try {
      const markdown = await loadPrompts()
      if (!markdown?.trim()) {
        setActionMsg('This report has no developer prompts.')
        return
      }
      const ok = await copyText(markdown)
      if (!ok) {
        setActionMsg('Could not write to the clipboard.')
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      if (err instanceof PromptsUnavailableError) {
        setPromptsUnavailable(true)
        return
      }
      setActionMsg(err?.message || 'Could not fetch developer prompts.')
    }
  }

  async function handleOpenPromptPack() {
    setActionMsg('')
    try {
      const markdown = await loadPrompts()
      if (!markdown?.trim()) {
        setActionMsg('This report has no developer prompts.')
        return
      }
      const slug = slugify(active?.qa_run_id || active?.id)
      openTextBlob(markdown, 'text/markdown;charset=utf-8', `${slug}.developer-prompts.md`)
    } catch (err) {
      if (err instanceof PromptsUnavailableError) {
        setPromptsUnavailable(true)
        return
      }
      setActionMsg(err?.message || 'Could not fetch the prompt pack.')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">QA Reports</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Professional QA reports per session and per run: workflows that passed or failed, every error
          with its evidence, data-verification results and file round-trip outcomes.
        </p>
      </div>

      <FilterBar
        values={filters}
        onChange={(next) => { setFilters(next); setActiveId(null) }}
        fields={[
          { key: 'qa_run_id', label: 'QA Run ID', placeholder: 'QA-RUN-…' },
          { key: 'product', label: 'Product', options: PRODUCT_FILTER_OPTIONS },
          {
            key: 'kind',
            label: 'Kind',
            options: [{ value: 'session', label: 'session' }, { value: 'final', label: 'final' }],
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:h-[calc(100vh-18rem)]">
        <div className="qa-card flex min-h-0 flex-col overflow-hidden p-0">
          <ul className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-auto">
            {isLoading && <li className="px-4 py-3 text-sm text-neutral-500">Loading reports…</li>}
            {isError && (
              <li className="px-4 py-3 text-sm text-red-700">
                Failed to load reports{error?.message ? `: ${error.message}` : '.'}
              </li>
            )}
            {!isLoading && !isError && reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => selectReport(r.id)}
                  className={classNames(
                    'block w-full px-4 py-3 text-left hover:bg-neutral-50',
                    activeId === r.id ? 'bg-aicountly-50' : '',
                  )}
                >
                  <div className="font-mono text-xs font-semibold text-neutral-900">{r.qa_run_id}</div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {productLabel(r.product_name)} · {fmtDate(r.generated_at)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="qa-badge bg-neutral-100 text-neutral-700">{r.kind}</span>
                    {r.environment ? <EnvBadge environment={r.environment} short /> : null}
                    {isSessionReport(r) && (
                      <span className="qa-badge bg-neutral-100 text-neutral-600">session #{r.session_id}</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
            {!isLoading && !isError && reports.length === 0 && (
              <li className="space-y-2 px-4 py-6 text-center text-sm text-neutral-500">
                <div>No reports match the current filters.</div>
                <Link to="/new-qa-run" className="qa-btn-primary mt-2 inline-flex text-xs">Start a QA run</Link>
              </li>
            )}
          </ul>
        </div>

        <div className="qa-card flex min-h-0 flex-col overflow-hidden p-0 lg:col-span-2">
          {!active && (
            <div className="grid flex-1 place-items-center px-4 py-10 text-sm text-neutral-500">
              Select a report to preview it.
            </div>
          )}
          {active && (
            <>
              <div className="shrink-0 space-y-2 border-b border-neutral-200 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-semibold text-neutral-900">
                      {active.qa_run_id}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {active.kind === 'session' ? 'Session report' : 'Final run report'}
                      {' · '}{productLabel(active.product_name)}
                      {' · '}{fmtDate(active.generated_at)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="qa-btn-secondary text-xs" onClick={() => openBlob(paths.html)}>
                      Open HTML report
                    </button>
                    <button type="button" className="qa-btn-secondary text-xs" onClick={() => openBlob(paths.json)}>
                      Open JSON evidence
                    </button>
                    {!promptsUnavailable && (
                      <>
                        <button type="button" className="qa-btn-secondary text-xs" onClick={handleOpenPromptPack}>
                          Open prompt pack
                        </button>
                        <button type="button" className="qa-btn-secondary text-xs" onClick={handleCopyPrompts}>
                          {copied ? 'Copied' : 'Copy developer prompts'}
                        </button>
                      </>
                    )}
                    <Link to={`/qa-runs/${encodeURIComponent(active.qa_run_id)}`} className="qa-btn-secondary text-xs">
                      Open QA run
                    </Link>
                    {isSessionReport(active) && (
                      <Link
                        to={`/sessions/${active.session_id}/log?from=${encodeURIComponent('/qa-reports')}&fromLabel=${encodeURIComponent('Reports')}`}
                        className="qa-btn-secondary text-xs"
                      >
                        Session log
                      </Link>
                    )}
                  </div>
                </div>
                {actionMsg && <p className="text-xs text-amber-800">{actionMsg}</p>}
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-neutral-100 px-4 py-1.5 text-[11px] uppercase tracking-wide text-neutral-500">
                  HTML preview
                </div>
                {html.isLoading && (
                  <div className="grid flex-1 place-items-center px-4 py-10 text-sm text-neutral-500">Loading preview…</div>
                )}
                {html.isError && (
                  <div className="grid flex-1 place-items-center px-4 py-10 text-center text-sm text-red-700">
                    Could not load the preview. The report file may be missing on the server.
                  </div>
                )}
                {!html.isLoading && !html.isError && typeof html.data === 'string' && (
                  <iframe
                    title="QA report preview"
                    className="min-h-[24rem] w-full flex-1 bg-white"
                    // Report HTML is generated server-side but treated as untrusted: scripts,
                    // same-origin access and popups stay blocked. Only user-initiated top-level
                    // navigation is allowed so in-report links still work.
                    sandbox="allow-top-navigation-by-user-activation"
                    srcDoc={html.data}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
