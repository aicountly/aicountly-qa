import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken, v1 } from './api'
import { clearControllerSsoHash, readControllerSsoToken } from './controllerSso'

const AuthCtx = createContext(null)
const SSO_ERROR_KEY = 'qa.sso_error'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ssoPending, setSsoPending] = useState(false)

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const { data } = await api.get(v1('/me'))
      setUser(data?.data ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loginWithControllerSso = useCallback(async (ssoToken) => {
    const { data } = await api.post(v1('/auth/controller-sso'), { token: ssoToken })
    if (!data?.ok) throw new Error(data?.error || 'Controller SSO failed')
    const token = data?.data?.token
    if (!token) throw new Error('SSO succeeded but no token was returned')
    setToken(token)
    setUser(data.data.user)
    sessionStorage.removeItem(SSO_ERROR_KEY)
    return data.data.user
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const ssoToken = readControllerSsoToken()
      if (!ssoToken) {
        await refresh()
        return
      }

      clearControllerSsoHash()
      setSsoPending(true)
      setLoading(true)

      try {
        await loginWithControllerSso(ssoToken)
      } catch (e) {
        sessionStorage.setItem(
          SSO_ERROR_KEY,
          e?.response?.data?.error || e.message || 'Console SSO login failed',
        )
      } finally {
        if (!cancelled) {
          setSsoPending(false)
          setLoading(false)
        }
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [loginWithControllerSso, refresh])

  const login = useCallback(async (email, password) => {
    const { data } = await api.post(v1('/auth/login'), { email, password })
    if (!data?.ok) throw new Error(data?.error || 'Login failed')
    const token = data?.data?.token
    if (!token) throw new Error('Login succeeded but no token was returned')
    setToken(token)
    setUser(data.data.user)
    return data.data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post(v1('/auth/logout'))
    } catch {
      /* ignore */
    }
    setToken('')
    setUser(null)
  }, [])

  const hasRole = useCallback(
    (roles) => {
      if (!user) return false
      const allowed = Array.isArray(roles) ? roles : [roles]
      return allowed.some((r) => (user.roles || []).includes(r))
    },
    [user],
  )

  return (
    <AuthCtx.Provider value={{ user, loading, ssoPending, login, loginWithControllerSso, logout, refresh, hasRole }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>')
  return ctx
}
