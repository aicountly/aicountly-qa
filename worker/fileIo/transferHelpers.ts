/**
 * Browser-side upload and download primitives shared by the file I/O engine.
 * Deliberately selector-tolerant: target apps vary, and a missing control is a
 * reportable QA finding rather than a crash.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Page } from 'playwright'

const FILE_INPUT_SELECTORS = [
  'input[type=file]',
  '[data-test=file-import] input',
  '[data-testid=file-input]',
  'input[name*="file" i]',
]

const SUBMIT_SELECTORS = [
  'button:has-text("Import")',
  'button:has-text("Upload")',
  'button:has-text("Save")',
  'button[type=submit]',
]

const DOWNLOAD_SELECTORS = [
  '[data-test=export]',
  'button:has-text("Export")',
  'a:has-text("Export")',
  'button:has-text("Download")',
  'a:has-text("Download")',
]

const ACCEPTED_PATTERN = /accepted|imported|uploaded|success|saved|complete/i
const REJECTED_PATTERN = /error|failed|invalid|not allowed|unsupported|rejected|denied/i

export interface UploadOutcome {
  ok: boolean
  detail: string
  selector?: string
  bodyExcerpt?: string
}

export interface DownloadOutcome {
  ok: boolean
  detail: string
  path?: string
  selector?: string
}

export async function uploadFixture(
  page: Page,
  filePath: string,
  extraSelectors: string[] = [],
): Promise<UploadOutcome> {
  const selectors = [...extraSelectors, ...FILE_INPUT_SELECTORS]

  for (const selector of selectors) {
    const input = page.locator(selector).first()
    if (!(await input.count().catch(() => 0))) continue

    await input.setInputFiles(filePath)
    const submit = page.locator(SUBMIT_SELECTORS.join(', ')).first()
    if (await submit.count().catch(() => 0)) {
      await submit.click().catch(() => null)
    }
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 2_000)
    const rejected = REJECTED_PATTERN.test(body) && !ACCEPTED_PATTERN.test(body)

    return {
      ok: !rejected,
      selector,
      detail: rejected
        ? `Upload of ${basename(filePath)} was rejected by the application.`
        : `Uploaded ${basename(filePath)}.`,
      bodyExcerpt: body.slice(0, 400),
    }
  }

  return { ok: false, detail: 'No file input was found on this screen.' }
}

export async function downloadArtifact(
  page: Page,
  outDir: string,
  scenarioKey: string,
  extraSelectors: string[] = [],
): Promise<DownloadOutcome> {
  mkdirSync(outDir, { recursive: true })
  const selectors = [...extraSelectors, ...DOWNLOAD_SELECTORS]

  for (const selector of selectors) {
    const trigger = page.locator(selector).first()
    if (!(await trigger.count().catch(() => 0))) continue

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
      trigger.click().catch(() => null),
    ])
    if (!download) continue

    const suggested = download.suggestedFilename() || `${scenarioKey}.bin`
    const outPath = join(outDir, suggested)
    await download.saveAs(outPath).catch(() => null)

    if (existsSync(outPath)) {
      return { ok: true, path: outPath, selector, detail: `Downloaded ${suggested}.` }
    }
  }

  return { ok: false, detail: 'No download was produced by any export control on this screen.' }
}

/** Negative test: the application must visibly refuse a mismatched file. */
export async function uploadExpectingRejection(
  page: Page,
  filePath: string,
  pattern: string | undefined,
  extraSelectors: string[] = [],
): Promise<UploadOutcome> {
  const selectors = [...extraSelectors, ...FILE_INPUT_SELECTORS]
  let attempted = false

  for (const selector of selectors) {
    const input = page.locator(selector).first()
    if (!(await input.count().catch(() => 0))) continue
    await input.setInputFiles(filePath)
    const submit = page.locator(SUBMIT_SELECTORS.join(', ')).first()
    if (await submit.count().catch(() => 0)) {
      await submit.click().catch(() => null)
    }
    attempted = true
    break
  }

  if (!attempted) {
    return { ok: false, detail: 'No file input was found, so the rejection path could not be exercised.' }
  }

  await page.waitForTimeout(1_000)
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 2_000)
  const expected = new RegExp(pattern || 'invalid|mime|file type|unsupported|not allowed', 'i')
  const rejected = expected.test(body)

  return {
    ok: rejected,
    detail: rejected
      ? `Application rejected ${basename(filePath)} as expected.`
      : `Application did NOT reject ${basename(filePath)}; no matching rejection message was shown.`,
    bodyExcerpt: body.slice(0, 400),
  }
}

/** Observer tiers: prove the upload control exists but was never used. */
export async function assertUploadBlocked(page: Page, extraSelectors: string[] = []): Promise<string[]> {
  const selectors = [...extraSelectors, ...FILE_INPUT_SELECTORS]
  const present: string[] = []
  for (const selector of selectors) {
    if (await page.locator(selector).count().catch(() => 0)) present.push(selector)
  }

  return present
}
