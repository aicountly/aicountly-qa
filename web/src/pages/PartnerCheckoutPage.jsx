import { useEffect, useState } from 'react'
import { fetchPartnerCheckout } from '../services/paymentApi'
import { preparePartnerCheckoutSession, runPartnerCheckout } from '../services/partnerCheckout'

function readCheckoutParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    reference: (params.get('ref') || params.get('donation_ref') || '').trim(),
    returnTo: (params.get('return_to') || '').trim(),
  }
}

function redirectIfCompleted(returnTo, reference, payment) {
  const url = new URL(returnTo)
  url.searchParams.set('donation_ref', reference)
  url.searchParams.set('payment_complete', '1')
  if (payment?.razorpay_payment_id) {
    url.searchParams.set('razorpay_payment_id', payment.razorpay_payment_id)
  }
  if (payment?.razorpay_order_id) {
    url.searchParams.set('razorpay_order_id', payment.razorpay_order_id)
  }
  window.location.assign(url.toString())
}

export default function PartnerCheckoutPage() {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [paymentSummary, setPaymentSummary] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function startCheckout() {
      const { reference, returnTo } = readCheckoutParams()

      if (!reference || !returnTo) {
        setStatus('error')
        setError('Invalid payment link. Missing payment reference or return URL.')
        return
      }

      try {
        const checkout = await fetchPartnerCheckout(reference, returnTo)
        if (cancelled) return

        if (checkout.already_completed && checkout.payment) {
          redirectIfCompleted(returnTo, reference, checkout.payment)
          return
        }

        if (!checkout.razorpay?.order_id) {
          throw new Error('Payment checkout is not available for this reference.')
        }

        setPaymentSummary(checkout.payment)
        setStatus('opening')

        const session = await preparePartnerCheckoutSession()
        if (cancelled) return

        if (!session.csrf_token) {
          throw new Error('Payment server did not return a security token.')
        }

        await runPartnerCheckout({
          reference,
          returnTo,
          razorpay: checkout.razorpay,
          csrfToken: session.csrf_token,
          onError: (message) => {
            if (cancelled) return
            setStatus('error')
            setError(message || 'Payment could not be completed.')
          },
        })
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(err.message || 'Unable to start secure checkout.')
      }
    }

    startCheckout()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-8 text-center shadow-2xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-300">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
          Secure payment on sispl.org
        </div>

        <h1 className="font-display text-2xl font-bold text-white">Processing your payment</h1>

        {paymentSummary && (
          <p className="mt-3 text-sm text-slate-400">
            {paymentSummary.client_name} · {paymentSummary.project_name} · {paymentSummary.currency}{' '}
            {Number(paymentSummary.amount).toFixed(2)}
          </p>
        )}

        {status === 'loading' || status === 'opening' ? (
          <div className="mt-8 space-y-3">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
            <p className="text-sm text-slate-300">
              {status === 'loading'
                ? 'Preparing Razorpay checkout…'
                : 'Complete payment in the Razorpay window. Do not close this tab.'}
            </p>
            <p className="text-xs text-slate-500">
              After payment you will return automatically to the donation site.
            </p>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="mt-8 space-y-4">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
