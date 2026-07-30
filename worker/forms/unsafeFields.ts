/**
 * Field-safety classification shared by every value the agent proposes for a
 * form field, whether it comes from the deterministic test-data engine or a
 * vision model. Credentials, OTPs, captchas and statutory identifiers must
 * never be filled with a synthesized or model-proposed value.
 */

export type FormFieldDescriptor = {
  tag: 'input' | 'select' | 'textarea'
  type: string
  name: string
  id: string
  placeholder: string
  ariaLabel: string
  label: string
  required: boolean
}

// "PIN" is deliberately absent: in this product a PIN code is a postal code.
const NEVER_FILL = /search|filter|\botp\b|captcha|password|passcode|token|secret|api.?key|\bcvv\b|signature/i

/**
 * Identifiers with checksums or registry lookups we must not invent. PAN is
 * included here even though the identifier itself has no checksum, because a
 * QA run must never propose a synthetic PAN into a live statutory field.
 */
const UNSAFE_IDENTIFIER = /gstin|\bgst\b|\bcin\b|\bllpin\b|\bdin\b|\btin\b|\bpan\b|aadhaar|aadhar|passport|account.?(no|number)|\bifsc\b|\bupi\b|\bmicr\b|\bswift\b|\biban\b|card.?(no|number)/i

/** Normalises separators so word-boundary rules work on snake_case names. */
function readable(field: FormFieldDescriptor): string {
  return [field.name, field.id, field.placeholder, field.ariaLabel, field.label]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Values the model must never be allowed to supply, whatever it returns.
 * Applied to every brain-proposed value before it reaches the page.
 */
export function isUnsafeToFill(field: FormFieldDescriptor): boolean {
  const blob = readable(field)
  return NEVER_FILL.test(blob) || UNSAFE_IDENTIFIER.test(blob)
}
