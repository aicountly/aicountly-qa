import { hostname } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env')
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}

loadDotEnv()

function int(key: string, def: number): number {
  const v = process.env[key]
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function bool(key: string, def: boolean): boolean {
  const v = process.env[key]
  if (v === undefined) return def
  return v === '1' || v.toLowerCase() === 'true'
}

export const config = {
  apiUrl:        process.env.QA_API_URL || 'http://localhost:8080/api',
  workerToken:   process.env.QA_WORKER_TOKEN || '',
  workerId:      process.env.QA_WORKER_ID || hostname(),
  pollIntervalMs:int('QA_POLL_INTERVAL_MS', 5000),
  heartbeatMs:   int('QA_HEARTBEAT_MS', 15000),
  reportsDir:    process.env.QA_REPORTS_DIR || '../qa-reports',
  headless:      bool('QA_HEADLESS', true),
  slowMo:        int('QA_SLOWMO_MS', 0),
}

export function validateConfig(): string[] {
  const errs: string[] = []
  if (!config.workerToken) errs.push('QA_WORKER_TOKEN is required')
  if (!config.apiUrl)      errs.push('QA_API_URL is required')
  return errs
}
