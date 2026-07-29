/**
 * Optional standalone consolidated-report builder used by `npm run qa:reports`
 * when running the worker offline (the API has the authoritative builder).
 *
 * Reads every session-level JSON report under the qa-reports run directory and
 * stitches them into a consolidated HTML + JSON.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export async function buildFinalReport(runDir: string): Promise<{ htmlPath: string; jsonPath: string; totals: Record<string, number> }> {
  const entries = await readdir(runDir, { withFileTypes: true })
  const sessions: Array<Record<string, unknown>> = []

  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith('session-')) continue
    const sessionDir = join(runDir, e.name)
    const reportPath = join(sessionDir, 'report.json')
    try {
      await stat(reportPath)
      const data = JSON.parse(await readFile(reportPath, 'utf8'))
      sessions.push(data)
    } catch {
      /* skip incomplete sessions */
    }
  }

  const totals = summarise(sessions)
  const json = { generated_at: new Date().toISOString(), totals, sessions }
  const jsonPath = join(runDir, 'consolidated.json')
  const htmlPath = join(runDir, 'consolidated.html')

  await writeFile(jsonPath, JSON.stringify(json, null, 2))
  await writeFile(htmlPath, renderHtml(json))

  return { htmlPath, jsonPath, totals }
}

function summarise(sessions: Array<Record<string, unknown>>): Record<string, number> {
  let passed = 0, failed = 0, skipped = 0
  const sev = { critical: 0, high: 0, medium: 0, low: 0, warning: 0 }
  for (const s of sessions) {
    const status = String(s.status)
    if (status === 'passed') passed++
    else if (status === 'failed' || status === 'partial') failed++
    else if (status === 'skipped') skipped++
    const sevKey = String(s.severity || 'low') as keyof typeof sev
    if (status !== 'passed' && sevKey in sev) sev[sevKey]++
  }
  return { total: sessions.length, passed, failed, skipped, ...sev }
}

function renderHtml(json: Record<string, unknown>): string {
  const totals = (json.totals ?? {}) as Record<string, number>
  const sessions = (json.sessions ?? []) as Array<Record<string, unknown>>
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>QA Consolidated Report</title>
<style>body{font:14px/1.5 Inter,system-ui,Arial,sans-serif;color:#111;background:#fff;margin:0}
.container{max-width:1100px;margin:0 auto;padding:24px}
.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:12px 0 16px}
.card{border:1px solid #e5e7eb;border-radius:10px;padding:10px;text-align:center}
.card .k{font-size:22px;font-weight:700}.card .v{font-size:11px;color:#888}
.pass{border-color:#16a34a;color:#16a34a}.fail{border-color:#dc2626;color:#dc2626}
table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:left}
th{background:#f0fdf4;color:#15803d}
</style></head><body><div class="container">
<h1>QA Consolidated Report</h1>
<div class="cards">
  <div class="card"><div class="k">${totals.total ?? 0}</div><div class="v">Sessions</div></div>
  <div class="card pass"><div class="k">${totals.passed ?? 0}</div><div class="v">Passed</div></div>
  <div class="card fail"><div class="k">${totals.failed ?? 0}</div><div class="v">Failed</div></div>
  <div class="card"><div class="k">${totals.skipped ?? 0}</div><div class="v">Skipped</div></div>
  <div class="card fail"><div class="k">${totals.critical ?? 0}</div><div class="v">Critical</div></div>
  <div class="card fail"><div class="k">${totals.high ?? 0}</div><div class="v">High</div></div>
</div>
<table><thead><tr><th>#</th><th>Session</th><th>Status</th><th>Severity</th></tr></thead><tbody>
${sessions.map((s, i) => `<tr><td>${i + 1}</td><td>${(s.session as Record<string, unknown>)?.name ?? ''}</td><td>${s.status}</td><td>${s.severity}</td></tr>`).join('')}
</tbody></table>
</div></body></html>`
}
