/**
 * Narrow error-register rows to a single run.
 *
 * `GET /v1/error-register` may ignore `qa_run_id` on older API builds, which
 * would otherwise show unrelated errors on a run page. Filtering here is a
 * no-op once the API honours the parameter.
 */
export function narrowToRun(rows, qaRunId) {
  const list = Array.isArray(rows) ? rows : []
  const runId = String(qaRunId ?? '').trim()
  if (!runId) return list

  return list.filter((row) => {
    const last = String(row?.last_seen_run_id ?? '')
    const first = String(row?.first_seen_run_id ?? '')
    return last === runId || first === runId
  })
}
