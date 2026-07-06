import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

function readControllerSsoToken() {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const params = new URLSearchParams(hash)
  return params.get('controller_sso') || ''
}

export default function Login() {
  const { login, loginWithControllerSso } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const from = loc.state?.from || '/'

  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ssoPending, setSsoPending] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const ssoToken = readControllerSsoToken()
    if (!ssoToken) return

    setSsoPending(true)
    setErr('')

    loginWithControllerSso(ssoToken)
      .then(() => {
        window.history.replaceState(null, '', '/login')
        nav(from, { replace: true })
      })
      .catch((e) => {
        setErr(e?.response?.data?.error || e.message || 'Console SSO login failed')
      })
      .finally(() => {
        setSsoPending(false)
      })
  }, [from, loginWithControllerSso, nav])

  async function onSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setErr('')
    try {
      await login(email.trim(), pass)
      nav(from, { replace: true })
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (ssoPending) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-gradient-to-br from-white to-aicountly-50 px-4">
        <div className="text-sm text-neutral-600">Signing you in from Console…</div>
      </div>
    )
  }

  return (
    <div className="grid h-screen w-screen place-items-center bg-gradient-to-br from-white to-aicountly-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-aicountly-600 text-sm font-bold text-white">QA</span>
          <div>
            <div className="text-base font-semibold text-neutral-900">AICOUNTLY QA Portal</div>
            <div className="text-xs text-neutral-500">qa.aicountly.org · Console SSO enabled</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="qa-card">
          <h1 className="text-lg font-semibold text-neutral-900">Sign in</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Open from <strong>Console → Top Controller Apps → QA</strong> for automatic sign-in,
            or use your QA credentials below.
          </p>

          <div className="mt-4">
            <label className="qa-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className="qa-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <label className="qa-label" htmlFor="pass">Password</label>
            <input
              id="pass"
              type="password"
              autoComplete="current-password"
              required
              className="qa-input"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </div>

          {err ? (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
          ) : null}

          <button type="submit" className="qa-btn-primary mt-5 w-full justify-center" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-neutral-400">
          Testing &amp; reporting only · does not modify target app code
        </p>
      </div>
    </div>
  )
}
