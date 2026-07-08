import axios from 'axios'
import { redirectToConsoleLogin } from './consoleAuth.js'

const baseURL = (import.meta.env.VITE_API_URL || '/api').replace(/\/v1\/?$/, '').replace(/\/$/, '')

export const api = axios.create({
  baseURL,
  timeout: 30_000,
  withCredentials: true,
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
      if (hadToken) {
        redirectToConsoleLogin()
      }
    }
    return Promise.reject(err)
  },
)

export const v1 = (path) => `/v1${path.startsWith('/') ? path : `/${path}`}`

/** Base API URL for opening report links (same origin as axios client). */
export function apiBaseUrl() {
  return (import.meta.env.VITE_API_URL || '/api').replace(/\/v1\/?$/, '').replace(/\/$/, '')
}

export function v1Absolute(path) {
  return `${apiBaseUrl()}${v1(path)}`
}
