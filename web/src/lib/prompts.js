import { api, v1 } from './api.js'

/** Thrown when the prompts endpoint is not deployed yet, so callers can hide the action. */
export class PromptsUnavailableError extends Error {
  constructor(message = 'Developer prompt pack is not available on this API version yet.') {
    super(message)
    this.name = 'PromptsUnavailableError'
  }
}

function unwrapMarkdown(body) {
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        return String(parsed?.data?.markdown ?? parsed?.markdown ?? '').trim() || trimmed
      } catch {
        return body
      }
    }
    return body
  }
  if (body && typeof body === 'object') {
    return String(body?.data?.markdown ?? body?.markdown ?? '')
  }
  return ''
}

/**
 * Fetch a developer prompt pack. The API may answer with `text/markdown` or with
 * the usual `{ok,data:{markdown}}` envelope, so both shapes are accepted.
 */
async function fetchPrompts(path) {
  try {
    const res = await api.get(path, {
      responseType: 'text',
      headers: { Accept: 'text/markdown, text/plain, application/json' },
    })
    return unwrapMarkdown(res.data)
  } catch (err) {
    const status = err?.response?.status
    if (status === 404 || status === 501) throw new PromptsUnavailableError()
    throw err
  }
}

export function fetchRunPrompts(qaRunId) {
  return fetchPrompts(v1(`/reports/${encodeURIComponent(qaRunId)}/prompts`))
}

export function fetchSessionPrompts(sessionId) {
  return fetchPrompts(v1(`/reports/session/${sessionId}/prompts`))
}

/** Open text in a new tab, downloading instead when the popup is blocked. */
export function openTextBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function slugify(value, fallback = 'qa-report') {
  const slug = String(value ?? '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || fallback
}
