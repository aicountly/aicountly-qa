/**
 * Declarative File I/O step runners driven by template steps (e.g. BKS_029).
 * The manifest-driven engine in fileIoEngine.ts is the richer path; these steps
 * remain for templates that script the flow explicitly.
 *
 * Observer-only environments never upload — assert blocked_by_safe_guard instead.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Page } from 'playwright'
import { config } from '../utils/config.js'
import { isObserverOnly } from '../utils/environments.js'
import { fileActionsAllowed, type GuardContext } from '../utils/safeActionGuard.js'
import { fixturesRoot } from './manifest.js'
import type { TemplateStep } from '../types.js'

export type FileIoBag = {
  index: number
  kind: string
  ok: boolean
  detail?: string
  error?: string
  data?: unknown
}

export type FileIoContext = {
  page: Page
  guard: GuardContext
  sessionDir: string
  exports: Record<string, string>
  productName: string
}

export function resolveFixturePath(fixture: string, productName: string): string {
  if (!fixture) throw new Error('fixture path required')
  if (fixture.startsWith('/')) return fixture

  const samples = fixturesRoot()
  const candidates = [
    ...(samples ? [resolve(samples, fixture), resolve(samples, productName, basename(fixture))] : []),
    resolve(config.fixturesDir, productName, basename(fixture)),
    resolve(config.fixturesDir, fixture),
    resolve(config.fixturesDir, basename(fixture)),
    resolve(process.cwd(), fixture),
    // Repo layout when developing next to server-php templates.
    resolve(process.cwd(), '../server-php/app/Database/Templates', productName, fixture),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error(`Fixture not found: ${fixture} (searched samples/fixtures and ${config.fixturesDir})`)
}

export async function runFileIoStep(step: TemplateStep, idx: number, ctx: FileIoContext): Promise<FileIoBag> {
  const kind = String(step.kind)
  switch (kind) {
    case 'file_import':
      return fileImport(step, idx, ctx)
    case 'expect_import_result':
      return expectImportResult(step, idx, ctx)
    case 'file_export':
      return fileExport(step, idx, ctx)
    case 'compare_file_roundtrip':
      return compareRoundtrip(step, idx, ctx)
    case 'file_upload_expect_rejected':
      return uploadExpectRejected(step, idx, ctx)
    case 'assert_file_upload_blocked':
      return assertUploadBlocked(step, idx, ctx)
    default:
      return { index: idx, kind, ok: false, error: `unknown file io kind ${kind}` }
  }
}

async function fileImport(step: TemplateStep, idx: number, ctx: FileIoContext): Promise<FileIoBag> {
  const gate = fileActionsAllowed(ctx.guard)
  if (!gate.allowed) {
    return {
      index: idx,
      kind: 'file_import',
      ok: false,
      error: `blocked_by_safe_guard: ${gate.reason}`,
      data: { blocked_by_safe_guard: true, reason: gate.reason },
    }
  }
  const fixture = resolveFixturePath(String(step.fixture || ''), ctx.productName)
  const selectors = selectorList(step)
  let uploaded = false
  for (const sel of selectors) {
    const input = ctx.page.locator(sel).first()
    if (!(await input.count().catch(() => 0))) continue
    await input.setInputFiles(fixture)
    uploaded = true
    break
  }
  if (!uploaded) {
    return { index: idx, kind: 'file_import', ok: false, error: 'no file input found' }
  }
  const submit = ctx.page.locator('button:has-text("Import"), button:has-text("Upload"), button[type=submit]').first()
  if (await submit.count()) await submit.click().catch(() => null)
  await ctx.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  return { index: idx, kind: 'file_import', ok: true, detail: basename(fixture) }
}

async function expectImportResult(step: TemplateStep, idx: number, ctx: FileIoContext): Promise<FileIoBag> {
  const re = new RegExp(String(step.matches || 'accepted|imported|success'), 'i')
  const body = await ctx.page.locator('body').innerText().catch(() => '')
  const ok = re.test(body)
  return {
    index: idx,
    kind: 'expect_import_result',
    ok,
    detail: body.slice(0, 200),
    error: ok ? undefined : `import result did not match ${re}`,
  }
}

async function fileExport(step: TemplateStep, idx: number, ctx: FileIoContext): Promise<FileIoBag> {
  const saveAs = String(step.save_as || 'export.bin')
  const outDir = join(ctx.sessionDir, 'exports')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, saveAs)

  const selectors = selectorList(step)
  let clicked = false
  for (const sel of selectors) {
    const btn = ctx.page.locator(sel).first()
    if (!(await btn.count().catch(() => 0))) continue
    const [download] = await Promise.all([
      ctx.page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
      btn.click().catch(() => null),
    ])
    if (download) {
      await download.saveAs(outPath)
      clicked = true
      break
    }
  }
  if (!clicked || !existsSync(outPath)) {
    return { index: idx, kind: 'file_export', ok: false, error: 'export download did not complete' }
  }
  ctx.exports[saveAs] = outPath
  return { index: idx, kind: 'file_export', ok: true, detail: outPath }
}

function compareRoundtrip(step: TemplateStep, idx: number, ctx: FileIoContext): FileIoBag {
  const fixture = resolveFixturePath(String(step.fixture || ''), ctx.productName)
  const exportKey = String(step.export_key || '')
  const exported = ctx.exports[exportKey]
  if (!exported || !existsSync(exported)) {
    return { index: idx, kind: 'compare_file_roundtrip', ok: false, error: `export "${exportKey}" missing` }
  }
  const ignore = Array.isArray(step.ignore_columns) ? (step.ignore_columns as string[]) : []
  const left = canonicalizeCsv(readFileSync(fixture, 'utf8'), ignore)
  const right = canonicalizeCsv(readFileSync(exported, 'utf8'), ignore)
  const ok = left === right
  return {
    index: idx,
    kind: 'compare_file_roundtrip',
    ok,
    detail: ok ? 'canonical CSV match' : 'canonical CSV mismatch',
    error: ok ? undefined : 'FILE_ROUNDTRIP_MATCH failed',
    data: { fixture, exported },
  }
}

async function uploadExpectRejected(step: TemplateStep, idx: number, ctx: FileIoContext): Promise<FileIoBag> {
  const gate = fileActionsAllowed(ctx.guard)
  if (!gate.allowed) {
    return {
      index: idx,
      kind: 'file_upload_expect_rejected',
      ok: true,
      detail: `skipped — ${gate.reason}`,
    }
  }
  const fixture = resolveFixturePath(String(step.fixture || ''), ctx.productName)
  const selectors = selectorList(step)
  for (const sel of selectors) {
    const input = ctx.page.locator(sel).first()
    if (!(await input.count().catch(() => 0))) continue
    // Playwright setInputFiles cannot override MIME; we still attempt upload and look for error UI.
    await input.setInputFiles(fixture)
    const submit = ctx.page.locator('button:has-text("Import"), button:has-text("Upload"), button[type=submit]').first()
    if (await submit.count()) await submit.click().catch(() => null)
    break
  }
  await ctx.page.waitForTimeout(800)
  const re = new RegExp(String(step.error_matches || 'invalid|mime|file type|unsupported'), 'i')
  const body = await ctx.page.locator('body').innerText().catch(() => '')
  const ok = re.test(body)
  return {
    index: idx,
    kind: 'file_upload_expect_rejected',
    ok,
    error: ok ? undefined : `expected rejection matching ${re}`,
    detail: body.slice(0, 200),
  }
}

async function assertUploadBlocked(step: TemplateStep, idx: number, ctx: FileIoContext): Promise<FileIoBag> {
  if (!isObserverOnly(ctx.guard.environment)) {
    return {
      index: idx,
      kind: 'assert_file_upload_blocked',
      ok: true,
      detail: 'not an observer-only environment — guard N/A',
    }
  }
  // Never call setInputFiles / upload on an observer-only tier.
  const selectors = selectorList(step)
  const present = []
  for (const sel of selectors) {
    if (await ctx.page.locator(sel).count().catch(() => 0)) present.push(sel)
  }
  return {
    index: idx,
    kind: 'assert_file_upload_blocked',
    ok: true,
    detail: 'blocked_by_safe_guard (no upload attempted)',
    data: {
      blocked_by_safe_guard: true,
      must_not_upload: true,
      file_inputs_seen: present,
      expected: step.expected ?? 'blocked_by_safe_guard',
    },
  }
}

function selectorList(step: TemplateStep): string[] {
  const single = typeof step.selector === 'string' ? [step.selector as string] : []
  const many = Array.isArray(step.selector_options) ? (step.selector_options as string[]) : []
  return [...single, ...many].filter(Boolean)
}

function canonicalizeCsv(text: string, ignoreColumns: string[]): string {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return ''
  const rows = lines.map(parseCsvLine)
  const header = rows[0].map((h) => h.trim())
  const ignoreIdx = new Set(
    header.map((h, i) => (ignoreColumns.some((c) => c.toLowerCase() === h.toLowerCase()) ? i : -1)).filter((i) => i >= 0),
  )
  const body = rows.slice(1).map((row) =>
    row.filter((_, i) => !ignoreIdx.has(i)).map((c) => c.trim()).join('\t'),
  )
  body.sort()
  const keptHeader = header.filter((_, i) => !ignoreIdx.has(i)).join('\t')
  return [keptHeader, ...body].join('\n')
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}
