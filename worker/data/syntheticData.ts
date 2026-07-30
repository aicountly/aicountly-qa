/**
 * Synthetic form-fill values for the vision agent, ported from
 * aicountly-smoke-app's data/syntheticData.ts. QA_-marked instead of
 * SMOKE-marked; provider ordering (Perplexity then OpenAI) is a backend-side
 * brain.data_providers setting, not hardcoded here.
 */

import { invokeBrain } from '../brain/ensemble.js'
import type { MarkDescriptor } from '../agent/marks.js'
import { isUnsafeToFill } from '../forms/unsafeFields.js'

export type SyntheticDataResult = {
  fields: Record<string, string>
  provider: string
}

const FORM_SYSTEM = `You generate realistic synthetic QA data for data-quality tests of business SaaS apps.
Prefer industry-standard field values for HRMS/accounting/ERP forms.
Every free-TEXT value MUST begin with the marker "QA-" (emails may use a qa. local-part).
Values a validator reads as a number are given bare, with no marker: phone/mobile/WhatsApp
numbers, amounts, quantities, PIN codes, dates (dd/mm/yyyy) and times.
Never invent statutory IDs (GSTIN, PAN, Aadhaar, bank account, IFSC, CIN) — leave those fields out.
Return JSON only: {"fields":{"Field Label":"QA-value"},"notes":""}`

export async function requestFormValues(input: {
  marks: MarkDescriptor[]
  product: string
  environment: string
  sessionName: string
  url: string
}): Promise<SyntheticDataResult> {
  const fillable = input.marks.filter((mark) => isFillable(mark))
  if (fillable.length === 0) {
    return { fields: {}, provider: 'none' }
  }
  const response = await invokeBrain(
    'synthetic_data',
    FORM_SYSTEM,
    JSON.stringify({
      product: input.product,
      environment: input.environment,
      session: input.sessionName,
      url: input.url,
      fields: fillable.map((mark) => ({
        mark: mark.mark,
        name: mark.name,
        tag: mark.tag,
        type: mark.type,
        value: mark.value,
      })),
    }),
    {
      expect_json: true,
      product: input.product,
      environment: input.environment,
    },
  )
  return {
    fields: readFields(response.final),
    provider: String(response.arbiter ?? 'unknown'),
  }
}

function isFillable(mark: MarkDescriptor): boolean {
  if (mark.disabled) return false
  const tag = mark.tag.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false
  const type = mark.type.toLowerCase()
  if (['hidden', 'password', 'file', 'submit', 'button', 'checkbox', 'radio', 'image'].includes(type)) {
    return false
  }
  if (String(mark.value || '').trim()) return false
  if (isUnsafeToFill({
    tag: tag as 'input' | 'select' | 'textarea',
    type: mark.type,
    name: mark.name,
    id: '',
    placeholder: '',
    ariaLabel: mark.name,
    label: mark.name,
    required: false,
  })) {
    return false
  }
  return true
}

function readFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  const source = (row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields))
    ? row.fields as Record<string, unknown>
    : row
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(source)) {
    if (key === 'notes' || key === 'fields') continue
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      out[key] = String(item)
    }
  }
  return out
}
