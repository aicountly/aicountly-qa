import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, setToken, v1 } from './api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get(v1('/me'))
      setUser(data?.data ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(async (email, password) => {
    const { data } = await api.post(v1('/auth/login'), { email, password })
    if (!data?.ok) throw new Error(data?.error || 'Login failed')
    setToken(data.data.token)
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
    <AuthCtx.Provider value={{ user, loading, login, logout, refresh, hasRole }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>')
  return ctx
}
