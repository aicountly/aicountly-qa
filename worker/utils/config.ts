import { hostname } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Distinct process / package identity — must never collide with smoke workers. */
export const WORKER_PACKAGE_NAME = 'aicountly-qa-worker'
export const WORKER_BANNER = 'AICOUNTLY QA Worker (dedicated)'

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
  apiUrl: process.env.QA_API_URL || 'http://localhost:8080/api',
  workerToken: process.env.QA_WORKER_TOKEN || '',
  workerId: process.env.QA_WORKER_ID || WORKER_PACKAGE_NAME || hostname(),
  pollIntervalMs: int('QA_POLL_INTERVAL_MS', 5000),
  heartbeatMs: int('QA_HEARTBEAT_MS', 15000),
  reportsDir: process.env.QA_REPORTS_DIR
    ? (process.env.QA_REPORTS_DIR.startsWith('/')
      ? process.env.QA_REPORTS_DIR
      : resolve(process.cwd(), process.env.QA_REPORTS_DIR))
    : resolve(process.cwd(), '../qa-reports'),
  fixturesDir: process.env.QA_FIXTURES_DIR
    ? resolve(process.cwd(), process.env.QA_FIXTURES_DIR)
    : resolve(process.cwd(), 'fixtures'),
  headless: bool('QA_HEADLESS', true),
  slowMo: int('QA_SLOWMO_MS', 0),
  packageName: WORKER_PACKAGE_NAME,
  banner: WORKER_BANNER,
  /**
   * 'template' | 'agent'. Follow-up wiring: once the backend brain.agent_mode
   * setting ships, prefer a pass-through field on the next-session payload
   * over this env var — see sessionRunner.ts's resolveAgentMode().
   */
  agentMode: (process.env.QA_AGENT_MODE || 'template').trim().toLowerCase(),
  maxScreensPerSession: int('QA_MAX_SCREENS_PER_SESSION', 60),
  stepScreenshotRetention: int('QA_STEP_SCREENSHOT_RETENTION', 120),
  /**
   * Off by default: the feature-gap review (competitor comparison) makes an
   * extra AI council call per session. Same backend-settings-pass-through
   * limitation as agentMode above — env var only until a real setting ships.
   */
  featureGapEnabled: bool('QA_FEATURE_GAP_ENABLED', false),
}

export function validateConfig(): string[] {
  const errs: string[] = []
  if (!config.workerToken) errs.push('QA_WORKER_TOKEN is required')
  if (!config.apiUrl) errs.push('QA_API_URL is required')
  // Hard-fail only when smoke lease credentials are present (wrong portal wiring).
  if (process.env.WORKER_SHARED_TOKEN) {
    errs.push('WORKER_SHARED_TOKEN is set — this dedicated QA worker uses QA_WORKER_TOKEN only')
  }
  if (process.env.WORKER_BACKEND_URL) {
    errs.push('WORKER_BACKEND_URL is set — this dedicated QA worker uses QA_API_URL only')
  }
  // Provider keys belong only in server-php/.env; the worker proxies AI calls
  // through the QA API and must never hold a key that could call a provider directly.
  for (const key of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY']) {
    if (process.env[key]) {
      errs.push(`${key} is set on the worker — provider keys belong only in server-php/.env; the worker proxies via QA_API_URL`)
    }
  }
  return errs
}

export function warnSmokeEnvCoupling(): void {
  const smokeKeys = Object.keys(process.env).filter((k) => k.startsWith('SMOKE_'))
  if (smokeKeys.length) {
    console.warn(
      `[${WORKER_PACKAGE_NAME}] Ignoring unrelated SMOKE_* env in process (${smokeKeys.join(', ')}). `
      + 'This worker reads QA_* only.',
    )
  }
}

/** Set Node process title so `ps` / PM2 list show the distinct name. */
export function applyProcessIdentity(): void {
  try {
    process.title = WORKER_PACKAGE_NAME
  } catch {
    /* ignore */
  }
}
