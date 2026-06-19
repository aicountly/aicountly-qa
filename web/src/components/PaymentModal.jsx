import { useCallback, useEffect, useState } from 'react'
import { site } from '../config/site'
import {
  createRequestId,
  fetchPaymentCsrfToken,
  resolveApiBase,
  submitPaymentIntent,
  verifyRazorpayPayment,
} from '../services/paymentApi'
import { openRazorpayCheckout } from '../services/razorpayCheckout'
import {
  sanitizeAmount,
  sanitizeClientName,
  sanitizeInvoiceRef,
  sanitizeProjectName,
  validatePaymentForm,
} from '../utils/paymentInput'

const CURRENCIES = [
  { value: 'INR', label: 'INR — Indian Rupee' },
  { value: 'USD', label: 'USD — US Dollar' },
]

export default function PaymentModal({ open, onClose }) {
  const [clientName, setClientName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [csrfToken, setCsrfToken] = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const [loadingToken, setLoadingToken] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  const loadSession = useCallback(async () => {
    setLoadingToken(true)
    setError('')
    setSessionReady(false)
    setCsrfToken('')

    try {
      const data = await fetchPaymentCsrfToken()
      if (!data.csrf_token) {
        throw new Error('Payment server did not return a security token.')
      }
      setCsrfToken(data.csrf_token)
      setSessionReady(true)
      if (data.razorpay_enabled === false) {
        setError('Razorpay is not configured on the server. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to api/.env')
        setSessionReady(false)
      }
    } catch (err) {
      setError(err.message || 'Unable to connect to the payment server.')
      setSessionReady(false)
    } finally {
      setLoadingToken(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, submitting])

  useEffect(() => {
    if (!open) {
      setError('')
      setSuccess(null)
      setSubmitting(false)
      return
    }

    loadSession()
  }, [open, loadSession])

  if (!open) return null

  const resetAndClose = () => {
    setClientName('')
    setProjectName('')
    setInvoiceRef('')
    setAmount('')
    setCurrency('INR')
    setError('')
    setSuccess(null)
    onClose()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!sessionReady || !csrfToken) {
      await loadSession()
      return
    }

    setError('')
    setSubmitting(true)

    const validationError = validatePaymentForm({
      clientName: clientName.trim(),
      projectName: projectName.trim(),
      invoiceRef: invoiceRef.trim(),
      amount,
      currency,
    })
    if (validationError) {
      setError(validationError)
      setSubmitting(false)
      return
    }

    try {
      const result = await submitPaymentIntent(
        {
          client_name: sanitizeClientName(clientName),
          project_name: sanitizeProjectName(projectName),
          invoice_ref: sanitizeInvoiceRef(invoiceRef),
          amount: Number(sanitizeAmount(amount)),
          currency,
          request_id: createRequestId(),
          website: '',
          company: '',
        },
        csrfToken,
      )

      if (!result.razorpay?.order_id) {
        throw new Error('Razorpay checkout could not be started.')
      }

      await openRazorpayCheckout(result.razorpay, {
        onSuccess: async (response) => {
          try {
            const verified = await verifyRazorpayPayment(
              {
                reference: result.payment.reference,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
              csrfToken,
            )
            setSuccess(verified.payment)
          } catch (verifyError) {
            setError(verifyError.message || 'Payment verification failed.')
          }
        },
        onFailure: (response) => {
          setError(response.error?.description || 'Payment failed. Please try again.')
        },
        onDismiss: () => {},
      })
    } catch (err) {
      setError(err.message || 'Payment request could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  const buttonLabel = loadingToken
    ? 'Connecting to payment server…'
    : submitting
      ? 'Opening Razorpay…'
      : sessionReady
        ? 'Pay with Razorpay'
        : 'Retry connection'

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={resetAndClose}
        aria-label="Close payment dialog"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto animate-fade-up rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl sm:p-8"
      >
        <button
          type="button"
          onClick={resetAndClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="mb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            Razorpay Secure Checkout
          </div>
          <h2 id="payment-title" className="font-display text-2xl font-bold text-white">
            Make a Payment
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Secure payment via Razorpay. Use letters and numbers only — special characters are not allowed.
          </p>
        </div>

        {success ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <p className="font-semibold text-emerald-300">Payment successful</p>
            <p className="mt-2 text-sm text-slate-300">
              Reference: <span className="font-mono text-white">{success.reference}</span>
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {success.client_name} · {success.project_name} · {success.currency}{' '}
              {Number(success.amount).toFixed(2)}
            </p>
            {success.razorpay_payment_id && (
              <p className="mt-1 text-xs text-slate-500">
                Razorpay ID: {success.razorpay_payment_id}
              </p>
            )}
            <button
              type="button"
              onClick={resetAndClose}
              className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="hidden" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
              <label htmlFor="company">Company</label>
              <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            {!sessionReady && !loadingToken && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Payment server not connected. API: {resolveApiBase()}
              </div>
            )}

            <div>
              <label htmlFor="client-name" className="mb-1.5 block text-sm font-medium text-slate-300">
                Client Name <span className="text-brand-400">*</span>
              </label>
              <input
                id="client-name"
                type="text"
                required
                minLength={2}
                maxLength={200}
                value={clientName}
                onChange={(event) => setClientName(sanitizeClientName(event.target.value))}
                placeholder="Company or client name"
                autoComplete="name"
                spellCheck={false}
                inputMode="text"
                title="Letters, numbers, and spaces only"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              <p className="mt-1 text-xs text-slate-500">Letters, numbers, and spaces only</p>
            </div>

            <div>
              <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium text-slate-300">
                Project Name <span className="text-brand-400">*</span>
              </label>
              <input
                id="project-name"
                type="text"
                required
                minLength={2}
                maxLength={200}
                value={projectName}
                onChange={(event) => setProjectName(sanitizeProjectName(event.target.value))}
                placeholder="e.g. Website Redesign"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                title="Letters, numbers, and spaces only"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              <p className="mt-1 text-xs text-slate-500">Letters, numbers, and spaces only</p>
            </div>

            <div>
              <label htmlFor="invoice-ref" className="mb-1.5 block text-sm font-medium text-slate-300">
                Invoice / Reference No.
              </label>
              <input
                id="invoice-ref"
                type="text"
                maxLength={100}
                value={invoiceRef}
                onChange={(event) => setInvoiceRef(sanitizeInvoiceRef(event.target.value))}
                placeholder="e.g. INV-2026-0042"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                pattern="[A-Za-z0-9-]*"
                title="Letters, numbers, and hyphens only"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              <p className="mt-1 text-xs text-slate-500">Letters, numbers, and hyphens only</p>
            </div>

            <div>
              <label htmlFor="currency" className="mb-1.5 block text-sm font-medium text-slate-300">
                Currency <span className="text-brand-400">*</span>
              </label>
              <select
                id="currency"
                required
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              >
                {CURRENCIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-slate-300">
                Amount ({currency}) <span className="text-brand-400">*</span>
              </label>
              <input
                id="amount"
                type="text"
                inputMode="decimal"
                required
                value={amount}
                onChange={(event) => setAmount(sanitizeAmount(event.target.value))}
                placeholder="Enter amount"
                autoComplete="off"
                spellCheck={false}
                pattern="[0-9]+(\.[0-9]{1,2})?"
                title="Numbers only (max 2 decimal places)"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {error && (
              <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <p>{error}</p>
                {!sessionReady && (
                  <button
                    type="button"
                    onClick={loadSession}
                    className="font-semibold text-red-200 underline hover:text-white"
                  >
                    Retry connection
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || loadingToken}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:from-brand-400 hover:to-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {buttonLabel}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          Secured by Razorpay · Need help?{' '}
          <a href={`mailto:${site.email}`} className="text-brand-400 hover:underline">
            {site.email}
          </a>
        </p>
      </div>
    </div>
  )
}
