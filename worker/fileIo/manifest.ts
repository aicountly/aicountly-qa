/**
 * Loads samples/fixtures/manifest.json and resolves the scenarios that apply to
 * a product and the screens a session actually reached.
 *
 * Lookup order for the manifest and its fixtures:
 *   1. $QA_FIXTURES_DIR
 *   2. <repo>/samples/fixtures      (canonical location, documented in docs/QA-FILE-IO.md)
 *   3. <worker>/fixtures            (legacy per-product fixtures shipped with the worker)
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../utils/config.js'

export type ScenarioKind = 'upload' | 'import' | 'export' | 'round_trip' | 'reject'

export interface FileIoScenario {
  key: string
  kind: ScenarioKind
  fixture: string
  expected_mime: string[]
  menu_hints: string[]
  expected_rows?: number
  key_columns: string[]
  numeric_columns: string[]
  numeric_tolerance: number
  ignore_columns: string[]
  reject_matches?: string
}

export interface ExecutionScope {
  urls: string[]
  titles: string[]
  labels: string[]
}

const DEFAULT_TOLERANCE = 0.01

let cachedRoot: string | null | undefined
let cachedManifest: Record<string, FileIoScenario[]> | null = null

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/** Directory that holds manifest.json and the per-product fixture folders. */
export function fixturesRoot(): string | null {
  if (cachedRoot !== undefined) return cachedRoot

  const candidates = [
    process.env.QA_FIXTURES_DIR ? resolve(process.cwd(), process.env.QA_FIXTURES_DIR) : '',
    resolve(process.cwd(), '../samples/fixtures'),
    resolve(process.cwd(), 'samples/fixtures'),
    resolve(moduleDir(), '../../samples/fixtures'),
    resolve(moduleDir(), '../fixtures'),
    config.fixturesDir,
  ].filter(Boolean)

  // A directory that actually holds manifest.json always wins: an earlier
  // candidate that merely exists must not shadow the real fixture root.
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'manifest.json'))) {
      cachedRoot = candidate
      return cachedRoot
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedRoot = candidate
      return cachedRoot
    }
  }

  cachedRoot = null
  return cachedRoot
}

export function loadManifest(root?: string | null): Record<string, FileIoScenario[]> {
  if (cachedManifest && !root) return cachedManifest

  const dir = root ?? fixturesRoot()
  if (!dir) return (cachedManifest = {})

  const path = join(dir, 'manifest.json')
  if (!existsSync(path)) return (cachedManifest = {})

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return (cachedManifest = {})
  }

  const manifest = parsed as {
    defaults?: { numeric_tolerance?: number }
    products?: Record<string, unknown[]>
  }
  const fallbackTolerance = Number(manifest.defaults?.numeric_tolerance ?? DEFAULT_TOLERANCE)

  const out: Record<string, FileIoScenario[]> = {}
  for (const [product, entries] of Object.entries(manifest.products ?? {})) {
    if (!Array.isArray(entries)) continue
    out[product.toLowerCase()] = entries
      .map((entry) => normalizeScenario(entry, fallbackTolerance))
      .filter((entry): entry is FileIoScenario => entry !== null)
  }

  cachedManifest = out
  return out
}

function normalizeScenario(entry: unknown, fallbackTolerance: number): FileIoScenario | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  const key = String(raw.key ?? '').trim()
  const fixture = String(raw.fixture ?? '').trim()
  const kind = String(raw.kind ?? '').trim() as ScenarioKind
  if (!key || !fixture) return null
  if (!['upload', 'import', 'export', 'round_trip', 'reject'].includes(kind)) return null

  const tolerance = Number(raw.numeric_tolerance)

  return {
    key,
    kind,
    fixture,
    expected_mime: stringList(raw.expected_mime),
    menu_hints: stringList(raw.menu_hints),
    expected_rows: Number.isFinite(Number(raw.expected_rows)) && raw.expected_rows !== undefined
      ? Number(raw.expected_rows)
      : undefined,
    key_columns: stringList(raw.key_columns),
    numeric_columns: stringList(raw.numeric_columns),
    numeric_tolerance: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : fallbackTolerance,
    ignore_columns: stringList(raw.ignore_columns),
    reject_matches: raw.reject_matches ? String(raw.reject_matches) : undefined,
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter(Boolean)
}

export function scenariosForProduct(product: string): FileIoScenario[] {
  return loadManifest()[String(product ?? '').toLowerCase()] ?? []
}

/**
 * A scenario only runs when the session actually reached a screen its menu hints
 * describe. Scenarios without hints always run.
 */
export function scenarioMatchesScope(scenario: FileIoScenario, scope: ExecutionScope): boolean {
  if (scenario.menu_hints.length === 0) return true
  const haystack = [...scope.urls, ...scope.titles, ...scope.labels]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')

  return scenario.menu_hints.some((hint) => {
    const normalized = hint.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return normalized !== '' && haystack.includes(normalized)
  })
}

/** Absolute path of a fixture declared in the manifest. */
export function resolveFixture(fixture: string, productName: string): string {
  if (!fixture) throw new Error('fixture path required')
  if (fixture.startsWith('/')) return fixture

  const roots = [fixturesRoot(), config.fixturesDir].filter(Boolean) as string[]
  const candidates: string[] = []
  for (const root of roots) {
    candidates.push(
      join(root, fixture),
      join(root, productName, basename(fixture)),
      join(root, basename(fixture)),
    )
  }
  candidates.push(resolve(process.cwd(), fixture))

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(`Fixture not found: ${fixture} (searched ${roots.join(', ') || 'no fixture root'})`)
}

/**
 * Copy the fixture into the session directory so the evidence bundle is
 * self-contained and the original can never be modified by a test.
 */
export function materializeFixture(
  scenario: FileIoScenario,
  productName: string,
  sessionDir: string,
): { name: string; sourcePath: string; runPath: string } {
  const sourcePath = resolveFixture(scenario.fixture, productName)
  const outDir = join(sessionDir, 'file-io', scenario.key)
  mkdirSync(outDir, { recursive: true })
  const name = basename(sourcePath)
  const runPath = join(outDir, name)
  copyFileSync(sourcePath, runPath)

  return { name, sourcePath, runPath }
}
