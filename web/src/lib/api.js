import axios from 'axios'

const baseURL = (import.meta.env.VITE_API_URL || '/api').replace(/\/v1\/?$/, '').replace(/\/$/, '')

export const api = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

const TOKEN_KEY = 'qa.token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

api.interceptors.request.use((config) => {
  const t = getToken()
  if (t) {
    if (typeof config.headers?.set === 'function') {
      config.headers.set('Authorization', `Bearer ${t}`)
    } else {
      config.headers.Authorization = `Bearer ${t}`
    }
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      const hadToken = getToken()
      setToken('')
      const onLogin = window.location.pathname.endsWith('/login')
      // Only hard-redirect when a session existed (expired token), not for anonymous /me probes
      if (hadToken && !onLogin) {
        window.location.assign('/login')
      }
    }
    return Promise.reject(err)
  },
)

export const v1 = (path) => `/v1${path.startsWith('/') ? path : `/${path}`}`
