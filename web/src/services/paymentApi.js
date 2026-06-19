/** Ensure API base always ends with /api (fixes VITE_API_URL=https://sispl.org without /api). */
function normalizeApiBase(url) {
  const trimmed = url.replace(/\/+$/, '')
  if (trimmed.endsWith('/api')) {
    return trimmed
  }
  return `${trimmed}/api`
}

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_URL?.trim()
  if (configured) {
    return normalizeApiBase(configured)
  }
  if (typeof window !== 'undefined') {
    return normalizeApiBase(window.location.origin)
  }
  return '/api'
}

export function createRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16)
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}

async function parseJsonResponse(response) {
  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(
        response.ok
          ? 'Payment server returned an invalid response. Confirm the API is at /api on your server.'
          : `Payment server error (${response.status}). Check that /api is deployed and .env is configured.`,
      )
    }
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return data
}

async function apiFetch(path, options = {}) {
  try {
    const response = await fetch(`${resolveApiBase()}${path}`, {
      cache: 'no-store',
      ...options,
    })
    return parseJsonResponse(response)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot reach payment API at ${resolveApiBase()}. Check network connection and VITE_API_URL.`,
      )
    }
    throw error
  }
}

export async function fetchPaymentCsrfToken() {
  return apiFetch('/payments/csrf', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
}

export async function submitPaymentIntent(payload, csrfToken) {
  return apiFetch('/payments', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(payload),
  })
}

export async function verifyRazorpayPayment(payload, csrfToken) {
  return apiFetch('/payments/verify', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(payload),
  })
}

export async function fetchPaymentStatus(reference, sync = false) {
  const query = sync ? '?sync=1' : ''
  return apiFetch(`/payments/${encodeURIComponent(reference)}${query}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
}

export async function fetchPartnerCheckout(reference, returnTo) {
  const params = new URLSearchParams({ return_to: returnTo })
  return apiFetch(`/payments/${encodeURIComponent(reference)}/checkout?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
}

export { resolveApiBase }
