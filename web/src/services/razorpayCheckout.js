const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let razorpayScriptPromise = null

export function loadRazorpayScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay can only load in the browser'))
  }

  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay)
  }

  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT_URL}"]`)
      if (existing) {
        existing.addEventListener('load', () => resolve(window.Razorpay))
        existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay checkout script')))
        return
      }

      const script = document.createElement('script')
      script.src = RAZORPAY_SCRIPT_URL
      script.async = true
      script.onload = () => {
        if (window.Razorpay) {
          resolve(window.Razorpay)
        } else {
          reject(new Error('Razorpay checkout script loaded but Razorpay is unavailable'))
        }
      }
      script.onerror = () => reject(new Error('Failed to load Razorpay checkout (check ad blocker or network)'))
      document.body.appendChild(script)
    })
  }

  return razorpayScriptPromise
}

export async function openRazorpayCheckout(config, handlers = {}) {
  const Razorpay = await loadRazorpayScript()

  return new Promise((resolve, reject) => {
    const options = {
      key: config.key_id,
      amount: config.amount,
      currency: config.currency,
      name: config.name,
      description: config.description,
      order_id: config.order_id,
      prefill: config.prefill || {},
      notes: config.notes || {},
      theme: { color: '#1a84f5' },
      handler: (response) => {
        handlers.onSuccess?.(response)
        resolve(response)
      },
      modal: {
        ondismiss: () => {
          handlers.onDismiss?.()
          resolve(null)
        },
      },
    }

    if (config.callback_url) {
      options.callback_url = config.callback_url
      options.redirect = config.redirect ?? true
    }

    const instance = new Razorpay(options)

    instance.on('payment.success', (response) => {
      handlers.onSuccess?.(response)
      resolve(response)
    })

    instance.on('payment.failed', (response) => {
      handlers.onFailure?.(response)
      reject(new Error(response.error?.description || 'Payment failed'))
    })

    try {
      instance.open()
    } catch (error) {
      reject(error)
    }
  })
}
