/**
 * Synthetic data marker applied to free-text values the vision agent types into
 * live forms. Numeric, phone, date, time and currency values are left unmarked —
 * and stripped if they arrive already marked — so validation still passes.
 */

export const QA_MARKER = (process.env.QA_DATA_MARKER || 'QA-').trim() || 'QA-'

export type MarkerFieldHint = {
  type?: string
  name?: string
  tag?: string
}

const SKIP_TYPES = new Set([
  'number', 'tel', 'date', 'datetime-local', 'month', 'week', 'time',
  'range', 'color', 'checkbox', 'radio', 'file', 'hidden',
])

const LEADING_MARKER = /^\s*(?:qa[-_ ]+)+/i
/** Deliberately narrow: "contact" would also match a person's name. */
const PHONE_FIELD = /mobile|phone|telephone|whatsapp|\bfax\b/i

export function applyMarker(value: string, hint: MarkerFieldHint = {}): string {
  const raw = String(value ?? '')
  if (!raw) return raw
  const type = String(hint.type || '').toLowerCase()
  const unmarked = stripMarker(raw)
  // The prompts ask the model to mark what it types, so a number arrives already
  // prefixed: "QA-9876543210" is rejected as an invalid mobile number. Take the
  // marker back off, rather than merely declining to add one.
  if (isNumberish(unmarked) || isDateLike(unmarked) || isTimeLike(unmarked)) return unmarked
  if (PHONE_FIELD.test(String(hint.name || '')) && digitsIn(unmarked).length >= 6) return unmarked
  if (SKIP_TYPES.has(type)) return unmarked
  if (isCurrencyCode(unmarked)) return unmarked
  if (type === 'email' || looksLikeEmail(raw)) {
    return markEmail(raw)
  }
  if (raw.toUpperCase().startsWith(QA_MARKER.toUpperCase())
    || raw.toUpperCase().startsWith('QA ')) {
    return raw
  }
  return `${QA_MARKER}${raw}`
}

function markEmail(value: string): string {
  const at = value.indexOf('@')
  if (at <= 0) return `${QA_MARKER}${value}`
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (local.toLowerCase().startsWith('qa.') || local.toLowerCase().startsWith('qa-')) {
    return value
  }
  return `qa.${local}@${domain}`
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function stripMarker(value: string): string {
  return value.replace(LEADING_MARKER, '').trim()
}

function digitsIn(value: string): string {
  return value.replace(/\D/g, '')
}

/** A value a validator will read as a number: digits plus separator punctuation. */
function isNumberish(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || !digitsIn(trimmed)) return false
  return /^[+()\s\d.,\-/:%]+$/.test(trimmed)
}

function isDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value.trim())
    || /^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())
}

function isTimeLike(value: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(value.trim())
}

function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value.trim())
}
