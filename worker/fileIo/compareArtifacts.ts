/**
 * Byte/MIME/structure comparison between a source fixture and the artifact the
 * target application produced. Data-level verification lives in
 * dataVerification.ts — this file only answers "is it the same shape of file?".
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

export interface ArtifactComparison {
  status: 'pass' | 'fail' | 'partial'
  source_sha256?: string
  result_sha256: string
  source_mime?: string
  result_mime: string
  source_bytes?: number
  result_bytes: number
  structure_ok: boolean
  structure_notes: string
}

export function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function detectMime(filePath: string, content: Buffer): string {
  if (content.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (content.subarray(0, 4).toString('hex') === '504b0304') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (content.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'

  const ext = extname(filePath).toLowerCase()
  return ({
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.ics': 'text/calendar',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

/** Round-trip comparison: fixture in, artifact out. */
export function compareArtifacts(sourcePath: string, resultPath: string): ArtifactComparison {
  const source = readFileSync(sourcePath)
  const result = readFileSync(resultPath)
  const sourceHash = sha256(source)
  const resultHash = sha256(result)
  const checks = structureCheck(sourcePath, source, resultPath, result)
  const exact = sourceHash === resultHash

  return {
    status: exact && checks.ok ? 'pass' : checks.ok ? 'partial' : 'fail',
    source_sha256: sourceHash,
    result_sha256: resultHash,
    source_mime: detectMime(sourcePath, source),
    result_mime: detectMime(resultPath, result),
    source_bytes: source.length,
    result_bytes: result.length,
    structure_ok: checks.ok,
    structure_notes: exact
      ? `Exact SHA-256 match. ${checks.notes}`
      : `Content hash differs. ${checks.notes}`,
  }
}

/**
 * An export is generated from live data, so hash-comparing it against the
 * fixture would be a false failure. Judge it on its own merits instead.
 */
export function inspectExportArtifact(resultPath: string, expectedMimes: string[]): ArtifactComparison {
  const result = readFileSync(resultPath)
  const resultMime = detectMime(resultPath, result)
  const mimeExpected = expectedMimes.length === 0 || expectedMimes.includes(resultMime)
  const structure = standaloneStructureCheck(resultPath, result)

  return {
    status: result.length > 0 && mimeExpected && structure.ok ? 'pass' : 'fail',
    result_sha256: sha256(result),
    result_mime: resultMime,
    result_bytes: result.length,
    structure_ok: structure.ok,
    structure_notes: [
      'Export validated without source-fixture hash comparison.',
      structure.notes,
      mimeExpected
        ? 'Result MIME is expected.'
        : `Result MIME ${resultMime} is outside the expected list: ${expectedMimes.join(', ')}.`,
    ].join(' '),
  }
}

export function csvShape(value: string): { headers: string[]; rows: number } {
  const lines = normalizeText(value).split('\n').filter(Boolean)
  return {
    headers: (lines[0] ?? '').split(',').map((item) => item.trim()),
    rows: Math.max(0, lines.length - 1),
  }
}

function structureCheck(
  sourcePath: string,
  source: Buffer,
  resultPath: string,
  result: Buffer,
): { ok: boolean; notes: string } {
  const ext = extname(sourcePath).toLowerCase()

  if (ext === '.csv') {
    const a = csvShape(source.toString('utf8'))
    const b = csvShape(result.toString('utf8'))
    const headersMatch = a.headers.join('\u0000') === b.headers.join('\u0000')
    return {
      ok: headersMatch && a.rows === b.rows,
      notes: `CSV source=${a.rows} rows/${a.headers.length} columns, `
        + `result=${b.rows} rows/${b.headers.length} columns; headers ${headersMatch ? 'match' : 'differ'}.`,
    }
  }

  if (ext === '.ics') {
    const a = countIcsEvents(source.toString('utf8'))
    const b = countIcsEvents(result.toString('utf8'))
    return {
      ok: a === b && a > 0,
      notes: `ICS source has ${a} VEVENT blocks, result has ${b}.`,
    }
  }

  if (ext === '.pdf') {
    const ok = source.subarray(0, 5).toString('ascii') === '%PDF-'
      && result.subarray(0, 5).toString('ascii') === '%PDF-'
    return { ok, notes: ok ? 'Both artifacts have PDF magic bytes.' : 'One artifact is missing PDF magic bytes.' }
  }

  if (ext === '.xlsx') {
    const sourceWorkbook = isWorkbook(source)
    const resultWorkbook = isWorkbook(result)
    return {
      ok: sourceWorkbook && resultWorkbook,
      notes: `Workbook signatures source=${sourceWorkbook}, result=${resultWorkbook}.`,
    }
  }

  if (isTextExtension(ext) && isTextExtension(extname(resultPath).toLowerCase())) {
    const same = normalizeText(source.toString('utf8')) === normalizeText(result.toString('utf8'))
    return { ok: same, notes: same ? 'Normalized text matches.' : 'Normalized text differs.' }
  }

  return { ok: source.length > 0 && result.length > 0, notes: 'Both artifacts are non-empty.' }
}

function standaloneStructureCheck(resultPath: string, result: Buffer): { ok: boolean; notes: string } {
  const ext = extname(resultPath).toLowerCase()

  if (ext === '.csv') {
    const shape = csvShape(result.toString('utf8'))
    const ok = shape.headers.some((header) => header !== '')
    return { ok, notes: `CSV export has ${shape.rows} rows and ${shape.headers.length} columns.` }
  }
  if (ext === '.ics') {
    const events = countIcsEvents(result.toString('utf8'))
    return { ok: events > 0, notes: `ICS export contains ${events} VEVENT blocks.` }
  }
  if (ext === '.pdf') {
    const ok = result.subarray(0, 5).toString('ascii') === '%PDF-'
    return { ok, notes: ok ? 'Export has PDF magic bytes.' : 'Export is missing PDF magic bytes.' }
  }
  if (ext === '.xlsx') {
    const ok = isWorkbook(result)
    return { ok, notes: ok ? 'Export has a workbook signature.' : 'Export is missing a workbook signature.' }
  }

  return { ok: result.length > 0, notes: result.length > 0 ? 'Export is non-empty.' : 'Export is empty.' }
}

function countIcsEvents(value: string): number {
  return (value.match(/BEGIN:VEVENT/gi) ?? []).length
}

function isWorkbook(value: Buffer): boolean {
  return value.subarray(0, 4).toString('hex') === '504b0304'
    || /<Workbook[\s>]/i.test(value.subarray(0, 4096).toString('utf8'))
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

function isTextExtension(ext: string): boolean {
  return ['.txt', '.md', '.csv', '.ics', '.svg', '.json'].includes(ext)
}
