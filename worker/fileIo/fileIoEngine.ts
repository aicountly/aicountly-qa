/**
 * Runs the manifest-driven file I/O scenarios for a session and turns each one
 * into a persisted verdict plus a validation result.
 *
 * Ordering per scenario:
 *   gate (observer tier / allow_safe_demo) → operator approval → upload/import
 *   → download/export → hash + MIME + structure → DATA verification → persist.
 */

import { join } from 'node:path'
import type { Page } from 'playwright'
import { postFileIoResult, uploadFileIoArtifact } from '../apiClient.js'
import { askOrRecallDecision } from '../nav/askDecision.js'
import { fileActionsAllowed, OBSERVER_ONLY_FILE_BLOCK_REASON, type GuardContext } from '../utils/safeActionGuard.js'
import { isObserverOnly } from '../utils/environments.js'
import type { FileIoTestPayload, Run, Session, TargetProfile, ValidationResult } from '../types.js'
import { compareArtifacts, inspectExportArtifact, type ArtifactComparison } from './compareArtifacts.js'
import { notApplicable, verifyData, type DataVerification } from './dataVerification.js'
import {
  materializeFixture,
  scenarioMatchesScope,
  scenariosForProduct,
  type ExecutionScope,
  type FileIoScenario,
} from './manifest.js'
import {
  assertUploadBlocked,
  downloadArtifact,
  uploadExpectingRejection,
  uploadFixture,
} from './transferHelpers.js'

export const FILE_IO_RULES = {
  TRANSFER: 'FILE_IO_TRANSFER_OK',
  MIME: 'FILE_IO_MIME_EXPECTED',
  STRUCTURE: 'FILE_IO_STRUCTURE_MATCH',
  ROWS: 'FILE_IO_ROW_COUNT_MATCH',
  VALUES: 'FILE_IO_KEY_VALUES_MATCH',
  TOTALS: 'FILE_IO_NUMERIC_TOTALS_MATCH',
  OBSERVER: 'FILE_IO_OBSERVER_UPLOAD_BLOCKED',
  REJECT: 'FILE_BAD_MIME_REJECTED',
} as const

export interface FileIoRunInput {
  page: Page
  session: Session
  run: Run
  profile: TargetProfile
  guard: GuardContext
  sessionDir: string
  scope: ExecutionScope
  /** Skip the operator approval prompt (used by --mode=basic-check). */
  autoApprove?: boolean
}

export interface FileIoRunOutput {
  tests: FileIoTestPayload[]
  validations: ValidationResult[]
}

export async function runFileIoScenarios(input: FileIoRunInput): Promise<FileIoRunOutput> {
  const scenarios = scenariosForProduct(input.profile.product_name)
  const tests: FileIoTestPayload[] = []
  const validations: ValidationResult[] = []

  for (const scenario of scenarios) {
    if (!scenarioMatchesScope(scenario, input.scope)) continue

    const outcome = await runScenario(scenario, input)
    tests.push(outcome.test)
    validations.push(...outcome.validations)

    const testId = await postFileIoResult(input.session.id, outcome.test).catch(() => null)
    if (testId !== null) {
      for (const [key, path] of Object.entries(outcome.test.artifact_paths)) {
        await uploadFileIoArtifact(testId, key, path).catch(() => null)
      }
    }
  }

  return { tests, validations }
}

async function runScenario(
  scenario: FileIoScenario,
  input: FileIoRunInput,
): Promise<{ test: FileIoTestPayload; validations: ValidationResult[] }> {
  const direction = directionFor(scenario)
  const base: FileIoTestPayload = {
    scenario_key: scenario.key,
    direction,
    fixture_name: scenario.fixture.split('/').pop() ?? scenario.fixture,
    upload_ok: false,
    download_ok: false,
    compare_status: 'skipped',
    structure_ok: false,
    artifact_paths: {},
    evidence: { menu_hints: scenario.menu_hints, kind: scenario.kind },
  }

  const needsWrite = scenario.kind !== 'export'
  const gate = needsWrite ? fileActionsAllowed(input.guard) : { allowed: true as const, reason: undefined }

  if (!gate.allowed) {
    const observer = gate.reason === OBSERVER_ONLY_FILE_BLOCK_REASON;
    const inputsSeen = await assertUploadBlocked(input.page)
    const test: FileIoTestPayload = {
      ...base,
      compare_status: observer ? 'blocked' : 'skipped',
      verification_notes: gate.reason,
      evidence: {
        ...base.evidence,
        gate_reason: gate.reason,
        blocked_by_safe_guard: observer,
        file_inputs_seen: inputsSeen,
        upload_attempted: false,
      },
    }

    // On observer tiers "blocked" is the PASSING outcome for the guard rule.
    return {
      test,
      validations: observer
        ? [{
          rule_code: FILE_IO_RULES.OBSERVER,
          passed: true,
          severity: 'critical',
          expected: 'no upload attempted on an observer-only environment',
          actual: `upload skipped; ${inputsSeen.length} file input(s) present but untouched`,
          notes: gate.reason,
        }]
        : [],
    }
  }

  if (scenario.kind === 'reject') {
    return runRejectScenario(scenario, input, base)
  }

  let fixture: { name: string; sourcePath: string; runPath: string } | undefined
  if (scenario.kind !== 'export') {
    try {
      fixture = materializeFixture(scenario, input.profile.product_name, input.sessionDir)
      base.fixture_name = fixture.name
      base.artifact_paths.fixture = fixture.runPath
    } catch (err) {
      return {
        test: {
          ...base,
          compare_status: 'fail',
          verification_notes: (err as Error).message,
          evidence: { ...base.evidence, fixture_error: (err as Error).message },
        },
        validations: [{
          rule_code: FILE_IO_RULES.TRANSFER,
          passed: false,
          severity: 'high',
          expected: `fixture ${scenario.fixture} available to the worker`,
          actual: (err as Error).message,
          notes: 'The worker could not stage the synthetic fixture, so the scenario did not run.',
        }],
      }
    }
  }

  const validations: ValidationResult[] = []
  const evidence: Record<string, unknown> = { ...base.evidence }
  let uploadOk = false
  let downloadOk = false

  if (fixture) {
    if (!input.autoApprove) {
      const choice = await askOrRecallDecision({
        page: input.page,
        session: input.session,
        run: input.run,
        profile: input.profile,
        situationKey: `upload_confirm:${input.profile.product_name}:${scenario.key}`.slice(0, 191),
        question: `Upload the synthetic QA fixture "${fixture.name}" for scenario "${scenario.key}"?`,
        options: [
          { id: 'approve_upload', label: 'Approve this synthetic upload', recommended: true },
          { id: 'skip_file_io', label: 'Skip this file I/O scenario' },
          { id: 'abort_session', label: 'Abort the session' },
        ],
        context: { scenario_key: scenario.key, fixture_name: fixture.name, synthetic: true },
      }).catch((err: Error) => {
        evidence.decision_error = err.message
        return null
      })

      if (!choice || choice.option.id !== 'approve_upload') {
        return {
          test: {
            ...base,
            compare_status: 'skipped',
            verification_notes: choice
              ? `Operator chose "${choice.option.label}".`
              : 'Operator decision could not be resolved.',
            evidence: { ...evidence, operator_choice: choice?.option.id ?? null },
          },
          validations: [],
        }
      }
    }

    const upload = await uploadFixture(input.page, fixture.runPath)
    uploadOk = upload.ok
    evidence.upload = upload
    validations.push({
      rule_code: FILE_IO_RULES.TRANSFER,
      passed: upload.ok,
      severity: 'high',
      expected: `${fixture.name} accepted by the import screen`,
      actual: upload.detail,
      notes: upload.bodyExcerpt,
    })
  }

  let downloadedPath: string | undefined
  if (scenario.kind === 'export' || scenario.kind === 'round_trip') {
    const download = await downloadArtifact(
      input.page,
      join(input.sessionDir, 'file-io', scenario.key, 'downloads'),
      scenario.key,
    )
    downloadOk = download.ok
    downloadedPath = download.path
    evidence.download = download
    validations.push({
      rule_code: FILE_IO_RULES.TRANSFER,
      passed: download.ok,
      severity: 'high',
      expected: 'export produces a downloadable artifact',
      actual: download.detail,
    })
    if (download.path) base.artifact_paths.downloaded = download.path
  }

  if (!downloadedPath) {
    const workflowOk = scenario.kind === 'upload' || scenario.kind === 'import' ? uploadOk : downloadOk
    return {
      test: {
        ...base,
        upload_ok: uploadOk,
        download_ok: downloadOk,
        compare_status: workflowOk ? 'not_applicable' : 'fail',
        verification_notes: workflowOk
          ? 'Upload completed; this scenario has no export leg, so no artifact comparison was possible.'
          : 'The file transfer did not complete, so no artifact could be compared.',
        evidence,
      },
      validations,
    }
  }

  const comparison: ArtifactComparison = scenario.kind === 'export'
    ? inspectExportArtifact(downloadedPath, scenario.expected_mime)
    : compareArtifacts(fixture!.runPath, downloadedPath)

  const mimeExpected = scenario.expected_mime.length === 0
    || scenario.expected_mime.includes(comparison.result_mime)

  validations.push({
    rule_code: FILE_IO_RULES.MIME,
    passed: mimeExpected,
    severity: 'high',
    expected: scenario.expected_mime.join(' | ') || '(any)',
    actual: comparison.result_mime,
  })
  validations.push({
    rule_code: FILE_IO_RULES.STRUCTURE,
    passed: comparison.structure_ok,
    severity: 'high',
    expected: 'headers, column count and container signature preserved',
    actual: comparison.structure_notes,
  })

  const verification: DataVerification = scenario.kind === 'export'
    ? notApplicable('Export content is dataset-dependent; row-level comparison against the fixture is not meaningful.')
    : verifyData(scenario, fixture!.runPath, downloadedPath)

  pushDataValidations(scenario, verification, validations)

  const compareStatus = resolveStatus(comparison, mimeExpected, verification)

  return {
    test: {
      ...base,
      upload_ok: uploadOk,
      download_ok: downloadOk,
      compare_status: compareStatus,
      source_sha256: comparison.source_sha256,
      result_sha256: comparison.result_sha256,
      source_mime: comparison.source_mime,
      result_mime: comparison.result_mime,
      source_bytes: comparison.source_bytes,
      result_bytes: comparison.result_bytes,
      structure_ok: comparison.structure_ok,
      structure_notes: comparison.structure_notes,
      rows_expected: verification.rows_expected ?? undefined,
      rows_found: verification.rows_found ?? undefined,
      mismatched_cells: verification.mismatched_cells,
      mismatches: verification.mismatches,
      totals_expected: verification.totals_expected,
      totals_found: verification.totals_found,
      data_verified: verification.verified,
      verification_notes: verification.notes,
      evidence: {
        ...evidence,
        expected_mime: scenario.expected_mime,
        mime_expected: mimeExpected,
        validation_mode: scenario.kind === 'export' ? 'export_structure' : 'round_trip_fidelity',
      },
    },
    validations,
  }
}

async function runRejectScenario(
  scenario: FileIoScenario,
  input: FileIoRunInput,
  base: FileIoTestPayload,
): Promise<{ test: FileIoTestPayload; validations: ValidationResult[] }> {
  let fixture: { name: string; runPath: string }
  try {
    fixture = materializeFixture(scenario, input.profile.product_name, input.sessionDir)
  } catch (err) {
    return {
      test: { ...base, compare_status: 'skipped', verification_notes: (err as Error).message },
      validations: [],
    }
  }

  const outcome = await uploadExpectingRejection(input.page, fixture.runPath, scenario.reject_matches)

  return {
    test: {
      ...base,
      fixture_name: fixture.name,
      direction: 'upload',
      upload_ok: false,
      compare_status: outcome.ok ? 'pass' : 'fail',
      verification_notes: outcome.detail,
      artifact_paths: { fixture: fixture.runPath },
      evidence: { ...base.evidence, reject: outcome, negative_test: true },
    },
    validations: [{
      rule_code: FILE_IO_RULES.REJECT,
      passed: outcome.ok,
      severity: 'high',
      expected: `upload of ${fixture.name} rejected with a visible message`,
      actual: outcome.detail,
      notes: outcome.bodyExcerpt,
    }],
  }
}

function pushDataValidations(
  scenario: FileIoScenario,
  verification: DataVerification,
  validations: ValidationResult[],
): void {
  if (verification.verified === null) return

  if (verification.rows_expected !== null) {
    validations.push({
      rule_code: FILE_IO_RULES.ROWS,
      passed: verification.rows_found === verification.rows_expected,
      severity: 'critical',
      expected: `${verification.rows_expected} data rows`,
      actual: `${verification.rows_found} data rows`,
      notes: verification.notes,
    })
  }

  if (scenario.key_columns.length > 0) {
    validations.push({
      rule_code: FILE_IO_RULES.VALUES,
      passed: verification.mismatched_cells === 0,
      severity: 'critical',
      expected: 'every key-matched cell value unchanged',
      actual: verification.mismatched_cells === 0
        ? 'no cell changed'
        : `${verification.mismatched_cells} cell(s) changed`,
      diff: verification.mismatches
        .slice(0, 5)
        .map((m) => `${m.key}.${m.column}: "${m.expected}" -> "${m.actual}"`)
        .join('; ') || undefined,
    })
  }

  for (const column of scenario.numeric_columns) {
    const expected = verification.totals_expected[column]
    const actual = verification.totals_found[column]
    if (expected === undefined || actual === undefined) continue
    validations.push({
      rule_code: FILE_IO_RULES.TOTALS,
      passed: Math.abs(expected - actual) <= scenario.numeric_tolerance,
      severity: 'critical',
      expected: `${column} total ${expected.toFixed(2)}`,
      actual: `${column} total ${actual.toFixed(2)}`,
      notes: `Tolerance ${scenario.numeric_tolerance}.`,
    })
  }
}

function resolveStatus(
  comparison: ArtifactComparison,
  mimeExpected: boolean,
  verification: DataVerification,
): FileIoTestPayload['compare_status'] {
  if (!mimeExpected) return 'fail'
  if (verification.verified === false) return 'fail'
  if (!comparison.structure_ok) return 'fail'
  if (comparison.status === 'pass') return 'pass'

  // Bytes differ but structure and data hold: the target re-serialised the file.
  return verification.verified === true ? 'pass' : 'partial'
}

function directionFor(scenario: FileIoScenario): FileIoTestPayload['direction'] {
  if (scenario.kind === 'round_trip') return 'round_trip'
  if (scenario.kind === 'export') return 'download'
  return 'upload'
}

/** Sessions opt into file I/O by name, module, or an explicit template step. */
export function shouldRunFileIo(session: Session): boolean {
  const haystack = `${session.name ?? ''} ${session.module ?? ''}`.toLowerCase()
  return /file\s*i\s*\/?\s*o|import|export|upload|download|attachment/.test(haystack)
}

export { isObserverOnly }
