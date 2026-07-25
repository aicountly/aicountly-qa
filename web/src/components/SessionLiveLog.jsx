import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, getToken, v1 } from '../lib/api.js'
import { StatusBadge } from './Badges.jsx'
import { fmtDate } from '../lib/format.js'

function EvidenceImage({ sessionId, filename }) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false

    ;(async () => {
      setError('')
      setSrc('')
      try {
        const res = await api.get(v1(`/sessions/${sessionId}/evidence`), {
          params: { filename },
          responseType: 'blob',
          // Avoid default Content-Type: application/json on binary GET
          headers: { 'Content-Type': undefined },
          timeout: 60_000,
        })
        if (cancelled) return

        const blob = res.data
        if (!(blob instanceof Blob) || blob.size === 0) {
          setError('Empty image response')
          return
        }
        // API errors often come back as JSON with 4xx — still a Blob when responseType is blob.
        if (blob.type && blob.type.includes('json')) {
          const text = await blob.text()
          let msg = 'Failed to load image'
          try {
            msg = JSON.parse(text)?.error || msg
          } catch {
            /* keep default */
          }
          setError(msg)
          return
        }

        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (err) {
        if (cancelled) return
        const status = err?.response?.status
        const data = err?.response?.data
        if (data instanceof Blob) {
          try {
            const parsed = JSON.parse(await data.text())
            setError(parsed?.error || `HTTP ${status || 'error'}`)
            return
          } catch {
            /* fall through */
          }
        }
        setError(err?.response?.data?.error || err?.message || `HTTP ${status || 'error'}`)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sessionId, filename])

  if (error) {
    return (
      <div className="flex h-36 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-center text-xs text-red-700">
        {error}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex h-36 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
        Loading…
      </div>
    )
  }

  return (
    <a href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-neutral-200">
      <img src={src} alt={filename} className="h-36 w-full object-cover object-top" />
    </a>
  )
}

export default function SessionLiveLog({ sessionId, sessionName, onClose }) {
  const logEndRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const live = useQuery({
    queryKey: ['session-live', sessionId],
    queryFn: async () => (await api.get(v1(`/sessions/${sessionId}/live`))).data?.data,
    enabled: !!sessionId,
    refetchInterval: (q) => {
      const status = q.state.data?.session?.status
      return ['queued', 'claimed', 'running'].includes(status) ? 2000 : 8000
    },
  })

  const events = live.data?.events || []
  const screenshots = live.data?.screenshots || []
  const status = live.data?.session?.status
  const outcome = live.data?.outcome
  const isLive = ['queued', 'claimed', 'running'].includes(status)

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events.length, autoScroll])

  const title = useMemo(
    () => sessionName || live.data?.session?.name || `Session #${sessionId}`,
    [sessionName, live.data?.session?.name, sessionId],
  )

  const outcomeBox = outcome?.state === 'success'
    ? 'border-aicountly-200 bg-aicountly-50 text-aicountly-900'
    : outcome?.state === 'failed'
      ? 'border-red-200 bg-red-50 text-red-900'
      : 'border-slate-200 bg-slate-50 text-slate-800'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-neutral-900">Live session log</h2>
              {status && <StatusBadge status={status} />}
              {isLive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-aicountly-50 px-2 py-0.5 text-[11px] font-medium text-aicountly-800">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-aicountly-600" />
                  Live
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">{title}</p>
            {outcome && (
              <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${outcomeBox}`}>
                <div className="font-semibold tracking-wide">{outcome.label}</div>
                {outcome.detail && <p className="mt-0.5 text-xs opacity-90">{outcome.detail}</p>}
              </div>
            )}
            {live.data?.activity && (
              <p className="mt-1 text-xs text-neutral-700">
                <span className="font-medium text-neutral-800">Now: </span>
                {live.data.activity}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-neutral-600">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              Auto-scroll
            </label>
            <button type="button" className="qa-btn-secondary text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-5">
          <div className="min-h-0 overflow-y-auto bg-neutral-950 px-3 py-3 font-mono text-[11px] leading-relaxed text-neutral-100 lg:col-span-3">
            {live.isLoading && <div className="text-neutral-400">Loading live log…</div>}
            {live.isError && (
              <div className="text-red-300">
                Could not load live log. {live.error?.response?.data?.error || live.error?.message || ''}
              </div>
            )}
            {!live.isLoading && events.length === 0 && (
              <div className="text-neutral-400">No activity yet. The worker will post updates as the session runs.</div>
            )}
            {!live.isLoading && events.length === 1 && isLive && (
              <div className="mb-2 text-amber-300">
                Waiting for worker step updates… If this stays stuck, restart the Playwright worker with the latest build (live progress enabled).
              </div>
            )}
            {events.map((ev, i) => (
              <div key={ev.id ?? i} className="mb-1.5 border-b border-white/5 pb-1.5 last:border-0">
                <div className="text-neutral-500">
                  [{fmtDate(ev.created_at) || '—'}]
                  {ev.event_type ? <span className="ml-1 text-aicountly-300">{ev.event_type}</span> : null}
                  {ev.step_index != null && ev.total_steps != null ? (
                    <span className="ml-1 text-neutral-400">
                      step {ev.step_index}/{ev.total_steps}
                    </span>
                  ) : null}
                </div>
                <div className="whitespace-pre-wrap text-neutral-100">{ev.message}</div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          <div className="min-h-0 overflow-y-auto border-t border-neutral-200 bg-neutral-50 p-3 lg:col-span-2 lg:border-l lg:border-t-0">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Screenshots</h3>
              <span className="text-[11px] text-neutral-500">{screenshots.length}</span>
            </div>
            {screenshots.length === 0 ? (
              <p className="text-xs text-neutral-500">
                No screenshots yet. They appear here as the worker uploads evidence.
              </p>
            ) : (
              <div className="space-y-3">
                {[...screenshots].reverse().map((shot) => (
                  <div key={shot.filename}>
                    <EvidenceImage sessionId={sessionId} filename={shot.filename} />
                    <div className="mt-1 text-[11px] text-neutral-500">
                      {fmtDate(shot.created_at)} · {shot.filename}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {live.data?.last_heartbeat_at && (
              <p className="mt-4 text-[11px] text-neutral-500">
                Last worker heartbeat: {fmtDate(live.data.last_heartbeat_at)}
              </p>
            )}
            {!getToken() && (
              <p className="mt-2 text-[11px] text-amber-800">Sign-in required to load screenshots.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
