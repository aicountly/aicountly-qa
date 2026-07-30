/**
 * Data-level verification of a file round trip. This is QA's half of the file
 * I/O story: a file can have the right MIME and the right shape and still have
 * lost, reordered, or silently rewritten the values inside it.
 *
 * Checks performed:
 *   - row count against the manifest's expected_rows and against the fixture
 *   - key column values present and unmodified (matched by key, not by position)
 *   - numeric column totals within the scenario tolerance
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { FileIoScenario } from './manifest.js'

export interface CellMismatch {
  key: string
  column: string
  expected: string
  actual: string
}

export interface DataVerification {
  verified: boolean | null
  rows_expected: number | null
  rows_found: number | null
  mismatched_cells: number
  mismatches: CellMismatch[]
  totals_expected: Record<string, number>
  totals_found: Record<string, number>
  notes: string
}

const MAX_REPORTED_MISMATCHES = 25

export function notApplicable(reason: string): DataVerification {
  return {
    verified: null,
    rows_expected: null,
    rows_found: null,
    mismatched_cells: 0,
    mismatches: [],
    totals_expected: {},
    totals_found: {},
    notes: reason,
  }
}

/**
 * @param sourcePath fixture that was uploaded (omit for pure exports)
 * @param resultPath artifact the application produced
 */
export function verifyData(
  scenario: FileIoScenario,
  sourcePath: string | undefined,
  resultPath: string,
): DataVerification {
  const ext = extname(resultPath).toLowerCase()

  if (ext === '.csv') return verifyCsv(scenario, sourcePath, resultPath)
  if (ext === '.ics') return verifyIcs(scenario, sourcePath, resultPath)

  return notApplicable(
    `No structured data verification for "${ext || 'unknown'}" artifacts; byte and MIME comparison still applied.`,
  )
}

function verifyCsv(
  scenario: FileIoScenario,
  sourcePath: string | undefined,
  resultPath: string,
): DataVerification {
  const result = parseCsv(readFileSync(resultPath, 'utf8'))
  const source = sourcePath ? parseCsv(readFileSync(sourcePath, 'utf8')) : null

  const rowsFound = result.rows.length
  const rowsExpected = scenario.expected_rows ?? source?.rows.length ?? null;

  const totalsFound = sumColumns(result, scenario.numeric_columns)
  const totalsExpected = source ? sumColumns(source, scenario.numeric_columns) : {}

  const notes: string[] = []
  let verified = true

  if (rowsExpected !== null) {
    if (rowsFound !== rowsExpected) {
      verified = false
      notes.push(`Row count mismatch: expected ${rowsExpected}, found ${rowsFound}.`)
    } else {
      notes.push(`Row count matches (${rowsFound}).`)
    }
  } else {
    notes.push(`Row count not declared; found ${rowsFound} rows.`)
  }

  const mismatches: CellMismatch[] = []
  const keyColumn = scenario.key_columns.find((column) => result.headers.includes(column))

  if (source && keyColumn) {
    const ignore = new Set(scenario.ignore_columns.map((column) => column.toLowerCase()))
    const comparable = source.headers.filter(
      (header) => result.headers.includes(header) && !ignore.has(header.toLowerCase()),
    )
    const resultByKey = new Map(result.rows.map((row) => [row[keyColumn] ?? '', row]))

    for (const sourceRow of source.rows) {
      const key = sourceRow[keyColumn] ?? ''
      const resultRow = resultByKey.get(key)
      if (!resultRow) {
        mismatches.push({ key, column: keyColumn, expected: key, actual: '(row missing)' })
        continue
      }
      for (const column of comparable) {
        const expected = (sourceRow[column] ?? '').trim()
        const actual = (resultRow[column] ?? '').trim()
        if (!valuesEqual(expected, actual, scenario)) {
          mismatches.push({ key, column, expected, actual })
        }
      }
    }

    if (mismatches.length > 0) {
      verified = false
      notes.push(
        `${mismatches.length} cell value(s) changed across the round trip, keyed on "${keyColumn}".`,
      )
    } else {
      notes.push(`All key-matched cell values survived the round trip (key column "${keyColumn}").`)
    }
  } else if (source && scenario.key_columns.length > 0) {
    notes.push(
      `Key column(s) ${scenario.key_columns.join(', ')} not present in the artifact; `
      + 'cell-level comparison skipped.',
    )
  }

  for (const column of scenario.numeric_columns) {
    const expected = totalsExpected[column]
    const actual = totalsFound[column]
    if (expected === undefined || actual === undefined) continue
    if (Math.abs(expected - actual) > scenario.numeric_tolerance) {
      verified = false
      notes.push(
        `Total for "${column}" differs: expected ${expected.toFixed(2)}, found ${actual.toFixed(2)} `
        + `(tolerance ${scenario.numeric_tolerance}).`,
      )
    } else {
      notes.push(`Total for "${column}" matches within tolerance (${actual.toFixed(2)}).`)
    }
  }

  return {
    verified,
    rows_expected: rowsExpected,
    rows_found: rowsFound,
    mismatched_cells: mismatches.length,
    mismatches: mismatches.slice(0, MAX_REPORTED_MISMATCHES),
    totals_expected: totalsExpected,
    totals_found: totalsFound,
    notes: notes.join(' '),
  }
}

function verifyIcs(
  scenario: FileIoScenario,
  sourcePath: string | undefined,
  resultPath: string,
): DataVerification {
  const resultUids = icsUids(readFileSync(resultPath, 'utf8'))
  const sourceUids = sourcePath ? icsUids(readFileSync(sourcePath, 'utf8')) : []
  const rowsExpected = scenario.expected_rows ?? (sourcePath ? sourceUids.length : null)

  const missing = sourceUids.filter((uid) => !resultUids.includes(uid))
  const notes: string[] = []
  let verified = true

  if (rowsExpected !== null && resultUids.length !== rowsExpected) {
    verified = false
    notes.push(`Event count mismatch: expected ${rowsExpected}, found ${resultUids.length}.`)
  } else {
    notes.push(`Event count matches (${resultUids.length}).`)
  }

  if (missing.length > 0) {
    verified = false
    notes.push(`Missing UID(s) after round trip: ${missing.join(', ')}.`)
  }

  return {
    verified,
    rows_expected: rowsExpected,
    rows_found: resultUids.length,
    mismatched_cells: missing.length,
    mismatches: missing.slice(0, MAX_REPORTED_MISMATCHES).map((uid) => ({
      key: uid,
      column: 'UID',
      expected: uid,
      actual: '(event missing)',
    })),
    totals_expected: {},
    totals_found: {},
    notes: notes.join(' '),
  }
}

/** Numbers compare numerically within tolerance; everything else compares as text. */
function valuesEqual(expected: string, actual: string, scenario: FileIoScenario): boolean {
  if (expected === actual) return true

  const a = toNumber(expected)
  const b = toNumber(actual)
  if (a !== null && b !== null) {
    return Math.abs(a - b) <= scenario.numeric_tolerance
  }

  return expected.replace(/\s+/g, ' ') === actual.replace(/\s+/g, ' ')
}

function toNumber(value: string): number | null {
  const cleaned = value.replace(/[,\s₹$]/g, '')
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function sumColumns(
  table: { headers: string[]; rows: Array<Record<string, string>> },
  columns: string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const column of columns) {
    if (!table.headers.includes(column)) continue
    let total = 0
    for (const row of table.rows) {
      const parsed = toNumber(row[column] ?? '')
      if (parsed !== null) total += parsed
    }
    out[column] = Number(total.toFixed(4))
  }
  return out
}

function icsUids(value: string): string[] {
  return [...value.matchAll(/^UID:(.+)$/gim)].map((match) => match[1].trim()).filter(Boolean)
}

export function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim()
    })
    return row
  })

  return { headers, rows }
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
