import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({
  baseURL: baseURL.replace(/\/$/, ''),
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
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      setToken('')
      if (!window.location.pathname.endsWith('/login')) {
        window.location.assign('/login')
      }
    }
    return Promise.reject(err)
  },
)

export const v1 = (path) => `/v1${path.startsWith('/') ? path : `/${path}`}`
