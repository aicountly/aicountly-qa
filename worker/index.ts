#!/usr/bin/env node
/**
 * AICOUNTLY QA Portal — dedicated Playwright worker entrypoint.
 *
 * Process / PM2 name: aicountly-qa-worker
 * Banner: AICOUNTLY QA Worker (dedicated)
 *
 * This is NOT the shared worker at worker.apis.aicountly.com.
 * Env: QA_* only (QA_API_URL, QA_WORKER_TOKEN, QA_REPORTS_DIR, …).
 *
 * Modes (--mode=<name> or npm run qa:<mode>):
 *   default        Poll API for next session, run it, repeat.
 *   basic-check    Production-safe: login + nav only (no dummy data writes).
 *   run-session    Claim/run exactly one session, then exit.
 *   books          Same as default (books filter is soft — API already claimed).
 *   reports        Rebuild consolidated report under a run directory.
 *   validate       Stub (validations run inline during session execution).
 *   cleanup        Documented no-op on production targets.
 *
 * Always runs ONE session at a time. Never parallel.
 */

import { fetchNextSession, pingWorker } from './apiClient.js'
import { runOneSession } from './runner/sessionRunner.js'
import { buildFinalReport } from './reporter/finalReportBuilder.js'
import {
  applyProcessIdentity,
  config,
  validateConfig,
  warnSmokeEnvCoupling,
  WORKER_BANNER,
  WORKER_PACKAGE_NAME,
} from './utils/config.js'

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

function printBanner(mode: Mode): void {
  const line = '='.repeat(64)
  console.log(line)
  console.log(`  ${WORKER_BANNER}`)
  console.log(`  package=${WORKER_PACKAGE_NAME}  pm2=${WORKER_PACKAGE_NAME}`)
  console.log(`  mode=${mode}  workerId=${config.workerId}`)
  console.log(`  api=${config.apiUrl}`)
  console.log(`  reports=${config.reportsDir}`)
  console.log(line)
}

async function main(): Promise<void> {
  applyProcessIdentity()
  const { mode, runDir } = parseArgs()
  printBanner(mode)
  warnSmokeEnvCoupling()

  const cfgErrs = validateConfig()
  if (mode !== 'reports' && cfgErrs.length) {
    console.error(`[${WORKER_PACKAGE_NAME}] config errors:`, cfgErrs.join(', '))
    process.exit(1)
  }

  switch (mode) {
    case 'reports': {
      if (!runDir) {
        console.error(`[${WORKER_PACKAGE_NAME}] --run-dir=<path-to-qa-reports/product/date/qa_run_id> required.`)
        process.exit(2)
      }
      const out = await buildFinalReport(runDir)
      console.log(`[${WORKER_PACKAGE_NAME}] consolidated report written:`, out.htmlPath, out.jsonPath)
      return
    }
    case 'validate': {
      console.log(`[${WORKER_PACKAGE_NAME}] validate mode: validations run inline during session execution.`)
      return
    }
    case 'cleanup': {
      console.log(`[${WORKER_PACKAGE_NAME}] cleanup refuses any production tier; sandbox cleanup is report-driven.`)
      return
    }
    case 'run-session': {
      const p = await fetchNextSession()
      if (!p.session) {
        console.log(`[${WORKER_PACKAGE_NAME}] no sessions queued.`)
        return
      }
      console.log(`[${WORKER_PACKAGE_NAME}] running session #${p.session.id}: ${p.session.name}`)
      await runOneSession(p)
      console.log(`[${WORKER_PACKAGE_NAME}] session complete.`)
      return
    }
    case 'basic-check': {
      const p = await fetchNextSession()
      if (!p.session) {
        console.log(`[${WORKER_PACKAGE_NAME}] no sessions queued.`)
        return
      }
      console.log(`[${WORKER_PACKAGE_NAME}] running basic-check for session #${p.session.id}`)
      await runOneSession(p, { basicCheck: true })
      console.log(`[${WORKER_PACKAGE_NAME}] basic-check complete.`)
      return
    }
    case 'books':
    case 'default': {
      console.log(`[${WORKER_PACKAGE_NAME}] entering poll loop. Ctrl+C to stop.`)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await pingWorker().catch(() => {})
          const p = await fetchNextSession()
          if (p.session) {
            if (mode === 'books' && p.profile?.product_name !== 'books') {
              console.log(
                `[${WORKER_PACKAGE_NAME}] claimed non-books session #${p.session.id} `
                + `(product=${p.profile?.product_name}) — running anyway (API already leased).`,
              )
            }
            console.log(`[${WORKER_PACKAGE_NAME}] claimed session #${p.session.id}: ${p.session.name}`)
            await runOneSession(p)
            console.log(`[${WORKER_PACKAGE_NAME}] finished session #${p.session.id}`)
          } else {
            await sleep(config.pollIntervalMs)
          }
        } catch (err) {
          console.error(`[${WORKER_PACKAGE_NAME}] loop error:`, (err as Error)?.message)
          await sleep(config.pollIntervalMs)
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let stopping = false
process.on('SIGINT', () => {
  if (stopping) process.exit(0)
  stopping = true
  console.log(`\n[${WORKER_PACKAGE_NAME}] SIGINT — will exit after current session drain (or press again).`)
  setTimeout(() => process.exit(0), 2_000)
})
process.on('SIGTERM', () => {
  console.log(`[${WORKER_PACKAGE_NAME}] SIGTERM received — shutting down.`)
  process.exit(0)
})

main().catch((err) => {
  console.error(`[${WORKER_PACKAGE_NAME}] fatal:`, err)
  process.exit(1)
})
