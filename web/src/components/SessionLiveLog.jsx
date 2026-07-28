import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, getToken, v1 } from '../lib/api.js'
import { StatusBadge } from './Badges.jsx'
import { fmtDate } from '../lib/format.js'

function useEvidenceBlob(sessionId, filename) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false

    ;(async () => {
      setError('')
      setSrc('')
      if (!sessionId || !filename) return
      try {
        const res = await api.get(v1(`/sessions/${sessionId}/evidence`), {
          params: { filename },
          responseType: 'blob',
          headers: { 'Content-Type': undefined },
          timeout: 60_000,
        })
        if (cancelled) return

        const blob = res.data
        if (!(blob instanceof Blob) || blob.size === 0) {
          setError('Empty image response')
          return
        }
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

  return { src, error }
}

function EvidenceThumb({ sessionId, filename, onOpen }) {
  const { src, error } = useEvidenceBlob(sessionId, filename)

  if (error) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-center text-xs text-red-700">
        {error}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
        Loading…
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(src, filename)}
      className="group relative block w-full overflow-hidden rounded-lg border border-neutral-200 text-left focus:outline-none focus:ring-2 focus:ring-aicountly-500"
    >
      <img src={src} alt={filename} className="h-40 w-full object-cover object-top transition group-hover:opacity-95" />
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
        View full image
      </span>
    </button>
  )
}

function ImageLightbox({ src, filename, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Full screenshot"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-full max-w-6xl flex-col overflow-hidden rounded-xl bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
          <div className="min-w-0 truncate text-xs text-neutral-200">{filename}</div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
            >
              Open in tab
            </a>
            <button
              type="button"
              className="rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <img src={src} alt={filename} className="mx-auto max-h-[80vh] w-auto max-w-full object-contain" />
        </div>
      </div>
    </div>
  )
}

/**
 * Full-page session live log: logs (left) + screenshots (right).
 */
export default function SessionLiveLog({
  sessionId,
  sessionName,
  backTo,
  backLabel = 'Back',
}) {
  const logEndRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [lightbox, setLightbox] = useState(null)

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
  const qaRunId = live.data?.session?.qa_run_id

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

  const resolvedBack = backTo
    || (qaRunId ? `/qa-runs/${encodeURIComponent(qaRunId)}` : '/qa-runs')

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden border-t border-neutral-200 bg-white">
      <div className="shrink-0 border-b border-neutral-200 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link to={resolvedBack} className="text-xs text-aicountly-700 hover:underline">
              ← {backLabel}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-neutral-900">Session log</h2>
              {status && <StatusBadge status={status} />}
              {isLive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-aicountly-50 px-2 py-0.5 text-[11px] font-medium text-aicountly-800">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-aicountly-600" />
                  Live
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-neutral-600">{title}</p>
            {qaRunId && (
              <p className="mt-0.5 font-mono text-[11px] text-neutral-500">{qaRunId}</p>
            )}
            {outcome && (
              <div className={`mt-2 max-w-3xl rounded-lg border px-3 py-2 text-sm ${outcomeBox}`}>
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
          <label className="flex items-center gap-1.5 text-xs text-neutral-600">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Auto-scroll
          </label>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-5">
        <div className="min-h-0 overflow-y-auto bg-neutral-950 px-4 py-3 font-mono text-[12px] leading-relaxed text-neutral-100 lg:col-span-3">
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
            <div key={ev.id ?? i} className="mb-2 border-b border-white/5 pb-2 last:border-0">
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

        <div className="min-h-0 overflow-y-auto border-t border-neutral-200 bg-neutral-50 p-4 lg:col-span-2 lg:border-l lg:border-t-0">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Screenshots</h3>
            <span className="text-[11px] text-neutral-500">{screenshots.length}</span>
          </div>
          {screenshots.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No screenshots yet. They appear here as the worker uploads evidence.
            </p>
          ) : (
            <div className="space-y-4">
              {[...screenshots].reverse().map((shot) => (
                <div key={shot.filename}>
                  <EvidenceThumb
                    sessionId={sessionId}
                    filename={shot.filename}
                    onOpen={(src, name) => setLightbox({ src, filename: name })}
                  />
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

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          filename={lightbox.filename}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
