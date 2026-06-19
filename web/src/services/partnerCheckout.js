import {
  fetchPaymentCsrfToken,
  fetchPaymentStatus,
  verifyRazorpayPayment,
} from './paymentApi'
import { openRazorpayCheckout } from './razorpayCheckout'

const POLL_INTERVAL_MS = 2000
const POLL_MAX_MS = 180000

function buildPartnerReturnUrl(returnTo, reference, payment, signature) {
  const url = new URL(returnTo)
  url.searchParams.set('donation_ref', reference)
  url.searchParams.set('payment_complete', '1')
  if (payment?.razorpay_payment_id) {
    url.searchParams.set('razorpay_payment_id', payment.razorpay_payment_id)
  }
  if (payment?.razorpay_order_id) {
    url.searchParams.set('razorpay_order_id', payment.razorpay_order_id)
  }
  if (signature) {
    url.searchParams.set('razorpay_signature', signature)
  }
  return url.toString()
}

function redirectToPartner(returnTo, reference, payment, signature) {
  window.location.assign(buildPartnerReturnUrl(returnTo, reference, payment, signature))
}

export async function runPartnerCheckout({ reference, returnTo, razorpay, csrfToken, onError }) {
  let settled = false
  let pollTimer = null

  const stopPolling = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const finish = (payment, signature = '') => {
    if (settled) return
    settled = true
    stopPolling()
    redirectToPartner(returnTo, reference, payment, signature)
  }

  const poll = async () => {
    if (settled) {
      stopPolling()
      return
    }

    try {
      const result = await fetchPaymentStatus(reference, true)
      if (result.payment?.status === 'completed') {
        finish(result.payment)
      }
    } catch {
      // Keep polling through transient errors.
    }
  }

  const startedAt = Date.now()
  poll()
  pollTimer = setInterval(() => {
    if (Date.now() - startedAt >= POLL_MAX_MS) {
      stopPolling()
      return
    }
    poll()
  }, POLL_INTERVAL_MS)

  const handleSuccess = async (response) => {
    stopPolling()
    try {
      const verified = await verifyRazorpayPayment(
        {
          reference,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        },
        csrfToken,
      )
      finish(verified.payment, response.razorpay_signature)
    } catch (verifyError) {
      try {
        const synced = await fetchPaymentStatus(reference, true)
        if (synced.payment?.status === 'completed') {
          finish(synced.payment, response.razorpay_signature)
          return
        }
      } catch {
        // Fall through to error below.
      }
      onError?.(verifyError.message || 'Payment verification failed.')
    }
  }

  await openRazorpayCheckout(
    {
      ...razorpay,
      callback_url: razorpay.callback_url,
      redirect: true,
    },
    {
      onSuccess: handleSuccess,
      onFailure: (response) => {
        stopPolling()
        onError?.(response.error?.description || 'Payment failed.')
      },
      onDismiss: () => {
        if (settled) return
        stopPolling()
        const dismissStartedAt = Date.now()
        poll()
        pollTimer = setInterval(() => {
          if (Date.now() - dismissStartedAt >= POLL_MAX_MS) {
            stopPolling()
            return
          }
          poll()
        }, POLL_INTERVAL_MS)
      },
    },
  )
}

export async function preparePartnerCheckoutSession() {
  return fetchPaymentCsrfToken()
}
