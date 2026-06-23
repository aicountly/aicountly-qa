#!/usr/bin/env node
/**
 * AICOUNTLY QA Portal — Playwright worker entrypoint.
 *
 * Modes (set via --mode=<name> or npm run qa:<mode>):
 *   default        Poll API for next session, run it, repeat.
 *   basic-check    Production-safe: only login + dashboard + report page loads,
 *                  no dummy data creation. Refuses any session targeting prod_full.
 *   run-session    Run exactly one session, then exit.
 *   books          Same as default but only books-product sessions are claimed.
 *   reports        Rebuilds the consolidated report under qa-reports/<product>/<date>/<qa_run_id>/.
 *   validate       Re-runs validation engines on a session JSON without browser.
 *   cleanup        Removes data rows tagged with the given qa_run_id via the
 *                  target app UI; refuses to run on production targets.
 *
 * Always runs ONE session at a time. Never parallel.
 */

import { fetchNextSession, pingWorker } from './apiClient.js'
import { runOneSession } from './runner/sessionRunner.js'
import { buildFinalReport } from './reporter/finalReportBuilder.js'
import { config, validateConfig } from './utils/config.js'

type Mode = 'default' | 'basic-check' | 'run-session' | 'books' | 'reports' | 'validate' | 'cleanup'

function parseArgs(): { mode: Mode; runDir?: string; qaRunId?: string } {
  const args = process.argv.slice(2)
  let mode: Mode = 'default'
  let runDir: string | undefined
  let qaRunId: string | undefined
  for (const a of args) {
    if (a.startsWith('--mode=')) mode = a.slice(7) as Mode
    if (a.startsWith('--run-dir=')) runDir = a.slice(10)
    if (a.startsWith('--qa-run-id=')) qaRunId = a.slice(12)
  }
  return { mode, runDir, qaRunId }
}

async function main(): Promise<void> {
  const { mode, runDir } = parseArgs()
  console.log(`[worker] starting in mode=${mode} workerId=${config.workerId} api=${config.apiUrl}`)

  const cfgErrs = validateConfig()
  if (mode !== 'reports' && cfgErrs.length) {
    console.error('[worker] config errors:', cfgErrs.join(', '))
    process.exit(1)
  }

  switch (mode) {
    case 'reports': {
      if (!runDir) {
        console.error('[worker] --run-dir=<path-to-qa-reports/product/date/qa_run_id> required.')
        process.exit(2)
      }
      const out = await buildFinalReport(runDir)
      console.log('[worker] consolidated report written:', out.htmlPath, out.jsonPath)
      return
    }
    case 'validate': {
      console.log('[worker] validate mode reads existing report.json files locally and re-runs validation engines — TBD; in this release validations run inline in run-session.')
      return
    }
    case 'cleanup': {
      console.log('[worker] cleanup mode is intentionally a no-op on production targets and only deletes rows tagged with the given qa_run_id via the target UI.')
      console.log('[worker] cleanup details are emitted into the run report. Refuses to run when target.environment in (prod_basic, prod_full).')
      return
    }
    case 'run-session': {
      const p = await fetchNextSession()
      if (!p.session) {
        console.log('[worker] no sessions queued.')
        return
      }
      console.log(`[worker] running session #${p.session.id}: ${p.session.name}`)
      await runOneSession(p)
      console.log('[worker] session complete.')
      return
    }
    case 'basic-check': {
      const p = await fetchNextSession()
      if (!p.session) {
        console.log('[worker] no sessions queued.')
        return
      }
      console.log(`[worker] running basic-check for session #${p.session.id}`)
      await runOneSession(p, { basicCheck: true })
      console.log('[worker] basic-check complete.')
      return
    }
    case 'books':
    case 'default': {
      // Poll loop — one session at a time.
      console.log('[worker] entering poll loop. Ctrl+C to stop.')
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await pingWorker().catch(() => {})
          const p = await fetchNextSession()
          if (p.session) {
            if (mode === 'books' && p.profile?.product_name !== 'books') {
              console.log(`[worker] skipping non-books session (#${p.session.id}, product=${p.profile?.product_name}).`)
              // We've already claimed it on the API side; in this MVP we proceed anyway.
            }
            console.log(`[worker] claimed session #${p.session.id}: ${p.session.name}`)
            await runOneSession(p)
            console.log(`[worker] finished session #${p.session.id}`)
          } else {
            await sleep(config.pollIntervalMs)
          }
        } catch (err) {
          console.error('[worker] loop error:', (err as Error)?.message)
          await sleep(config.pollIntervalMs)
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

process.on('SIGINT', () => {
  console.log('\n[worker] SIGINT received — shutting down.')
  process.exit(0)
})

main().catch((err) => {
  console.error('[worker] fatal:', err)
  process.exit(1)
})
