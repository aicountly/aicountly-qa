import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const from = loc.state?.from || '/'

  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

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

  return (
    <div className="grid h-screen w-screen place-items-center bg-gradient-to-br from-white to-aicountly-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-aicountly-600 text-sm font-bold text-white">QA</span>
          <div>
            <div className="text-base font-semibold text-neutral-900">AICOUNTLY QA Portal</div>
            <div className="text-xs text-neutral-500">qa.aicountly.org · independent auth</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="qa-card">
          <h1 className="text-lg font-semibold text-neutral-900">Sign in</h1>
          <p className="mt-1 text-xs text-neutral-500">
            This portal does <strong>not</strong> use my.aicountly.com login.
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
