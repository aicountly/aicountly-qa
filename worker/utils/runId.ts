/**
 * QA run-id helpers. Format: QA-RUN-YYYYMMDD-NNNN.
 * The authoritative generator lives in the API (App\Libraries\RunIdGenerator).
 * The worker only formats / interpolates run-ids into template data.
 */

const RE = /^QA-RUN-(\d{4})(\d{2})(\d{2})-(\d{4})$/

export function isValidRunId(id: string): boolean {
  return RE.test(id)
}

export function dateFromRunId(id: string): string | null {
  const m = id.match(RE)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

export function interpolate<T>(input: T, qaRunId: string, extra: Record<string, string> = {}): T {
  const replacements: Record<string, string> = { QA_RUN_ID: qaRunId, ...extra }
  return walk(input, replacements) as T
}

function walk(node: unknown, repl: Record<string, string>): unknown {
  if (typeof node === 'string') {
    return node.replace(/\{(\w+)\}/g, (_, key: string) => (repl[key] !== undefined ? repl[key] : `{${key}}`))
  }
  if (Array.isArray(node)) {
    return node.map((x) => walk(x, repl))
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(v, repl)
    }
    return out
  }
  return node
}

export function tag(qaRunId: string, suffix: string): string {
  return `${qaRunId} ${suffix}`
}

export function tagVoucherNumber(qaRunId: string, kind: string, seq: number): string {
  return `${qaRunId}-${kind}-${String(seq).padStart(3, '0')}`
}
