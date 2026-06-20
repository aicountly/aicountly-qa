/**
 * Test Data Engine — produces deterministic per-run data by stamping the
 * qa_run_id into every name/reference field.
 *
 * The canonical data comes from the API (qa_test_data_packs.data_json) or, when
 * running standalone for tests, from the bundled booksTestData defaults.
 */

import type { Pack } from '../types.js'
import { interpolate } from '../utils/runId.js'
import { booksFallback } from './booksTestData.js'

export interface PreparedData {
  raw: Record<string, unknown>
  forRun(qaRunId: string): Record<string, unknown>
}

export function preparePack(pack?: Pack | null): PreparedData {
  const data = (pack?.data_json ?? booksFallback) as Record<string, unknown>
  return {
    raw: data,
    forRun(qaRunId: string) {
      return interpolate(data, qaRunId)
    },
  }
}

export function pickKeys(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (k in data) out[k] = data[k]
  }
  return out
}
