import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseCsv, verifyData } from './dataVerification.js'
import type { FileIoScenario } from './manifest.js'

const scenario: FileIoScenario = {
  key: 'test-round-trip',
  kind: 'round_trip',
  fixture: 'test/rows.csv',
  expected_mime: ['text/csv'],
  menu_hints: [],
  expected_rows: 2,
  key_columns: ['reference'],
  numeric_columns: ['debit'],
  numeric_tolerance: 0.01,
  ignore_columns: ['id'],
}

const SOURCE = 'reference,narration,debit,id\nREF-1,Opening,100.00,1\nREF-2,Fees,250.50,2\n'

function write(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-fileio-'))
  const path = join(dir, name)
  writeFileSync(path, body)
  return path
}

describe('dataVerification', () => {
  it('passes when the round trip preserves rows, cells and totals', () => {
    const source = write('source.csv', SOURCE)
    // Reordered columns and a rewritten id: both are legitimate.
    const result = write('result.csv', 'id,reference,narration,debit\n99,REF-1,Opening,100.00\n98,REF-2,Fees,250.50\n')

    const v = verifyData(scenario, source, result)

    assert.equal(v.verified, true)
    assert.equal(v.rows_expected, 2)
    assert.equal(v.rows_found, 2)
    assert.equal(v.mismatched_cells, 0)
    assert.equal(v.totals_found.debit, 350.5)
  })

  it('flags a changed cell value against its key column', () => {
    const source = write('source.csv', SOURCE)
    const result = write('result.csv', 'reference,narration,debit,id\nREF-1,Opening,100.00,1\nREF-2,Fee,250.50,2\n')

    const v = verifyData(scenario, source, result)

    assert.equal(v.verified, false)
    assert.equal(v.mismatched_cells, 1)
    assert.equal(v.mismatches[0].key, 'REF-2')
    assert.equal(v.mismatches[0].column, 'narration')
    assert.equal(v.mismatches[0].actual, 'Fee')
  })

  it('flags a dropped row and a numeric total drift', () => {
    const source = write('source.csv', SOURCE)
    const result = write('result.csv', 'reference,narration,debit,id\nREF-1,Opening,100.00,1\n')

    const v = verifyData(scenario, source, result)

    assert.equal(v.verified, false)
    assert.equal(v.rows_found, 1)
    assert.equal(v.totals_found.debit, 100)
    assert.match(v.notes, /Row count mismatch/)
  })

  it('treats numeric formatting differences within tolerance as equal', () => {
    const source = write('source.csv', SOURCE)
    const result = write('result.csv', 'reference,narration,debit,id\nREF-1,Opening,100,1\nREF-2,Fees,"250.5",2\n')

    const v = verifyData(scenario, source, result)

    assert.equal(v.verified, true)
    assert.equal(v.mismatched_cells, 0)
  })

  it('reports not-applicable for formats it cannot read structurally', () => {
    const result = write('result.pdf', '%PDF-1.4 nothing to see')

    const v = verifyData(scenario, undefined, result)

    assert.equal(v.verified, null)
    assert.match(v.notes, /No structured data verification/)
  })

  it('parses quoted CSV cells containing commas and escaped quotes', () => {
    const parsed = parseCsv('a,b\n"x,1","he said ""hi"""\n')

    assert.deepEqual(parsed.headers, ['a', 'b'])
    assert.deepEqual(parsed.rows, [{ a: 'x,1', b: 'he said "hi"' }])
  })
})
