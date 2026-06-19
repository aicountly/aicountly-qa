/** Allowed: letters, numbers, spaces only (no special characters). */
const CLIENT_NAME_FILTER = /[^\p{L}\p{N} ]+/gu

/** Allowed: letters, numbers, hyphen only. */
const INVOICE_FILTER = /[^A-Za-z0-9-]+/g

const AMOUNT_FILTER = /[^0-9.]/g

export function sanitizeClientName(value) {
  return value
    .replace(CLIENT_NAME_FILTER, '')
    .replace(/\s+/g, ' ')
    .slice(0, 200)
}

export function sanitizeProjectName(value) {
  return sanitizeClientName(value)
}

export function sanitizeInvoiceRef(value) {
  return value.replace(INVOICE_FILTER, '').slice(0, 100)
}

export function sanitizeAmount(value) {
  const cleaned = String(value).replace(AMOUNT_FILTER, '')
  const dotIndex = cleaned.indexOf('.')
  if (dotIndex === -1) {
    return cleaned.slice(0, 10)
  }
  const whole = cleaned.slice(0, dotIndex).slice(0, 10)
  const fraction = cleaned.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2)
  return `${whole}.${fraction}`
}

export function validatePaymentForm({ clientName, projectName, invoiceRef, amount, currency }) {
  const name = clientName.trim()
  if (name.length < 2) {
    return 'Client name must be at least 2 characters (letters and numbers only).'
  }
  if (!/^[\p{L}\p{N} ]+$/u.test(name)) {
    return 'Client name can only contain letters, numbers, and spaces.'
  }

  const project = projectName.trim()
  if (project.length < 2) {
    return 'Project name must be at least 2 characters (letters and numbers only).'
  }
  if (!/^[\p{L}\p{N} ]+$/u.test(project)) {
    return 'Project name can only contain letters, numbers, and spaces.'
  }

  const invoice = invoiceRef.trim()
  if (invoice && !/^[A-Za-z0-9-]+$/.test(invoice)) {
    return 'Invoice reference can only contain letters, numbers, and hyphens.'
  }

  if (!['INR', 'USD'].includes(currency)) {
    return 'Please select a valid currency.'
  }

  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 'Enter a valid amount greater than zero.'
  }
  if (numericAmount > 99999999.99) {
    return 'Amount is too large.'
  }

  return ''
}
