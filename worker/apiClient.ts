/**
 * QA Portal API client used by the dedicated Playwright worker.
 * Authenticates with X-Worker-Token (QA_WORKER_TOKEN).
 */

import axios, { type AxiosInstance } from 'axios'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  DecisionOption,
  DecisionRow,
  FileIoTestPayload,
  NextSessionPayload,
  SessionPostBody,
} from './types.js'
import { config } from './utils/config.js'

let client: AxiosInstance | null = null

function api(): AxiosInstance {
  if (client) return client
  client = axios.create({
    baseURL: config.apiUrl.replace(/\/$/, ''),
    timeout: 60_000,
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Token': config.workerToken,
      'X-Worker-Id': config.workerId,
      'User-Agent': `${config.packageName}/0.2 (+dedicated-qa-worker)`,
    },
  })
  return client
}

function workerParams(): { worker_id: string } {
  return { worker_id: config.workerId }
}

export async function fetchNextSession(): Promise<NextSessionPayload> {
  const { data } = await api().get(`/v1/worker/next-session`, {
    params: workerParams(),
  })
  return (data?.data ?? data) as NextSessionPayload
}

export async function pingWorker(): Promise<void> {
  await api().post(`/v1/worker/ping`, {
    worker_id: config.workerId,
    package: config.packageName,
    banner: config.banner,
  }, {
    params: workerParams(),
  })
}

export async function heartbeat(
  sessionId: number,
  body: {
    message?: string
    activity?: string
    step?: string
    step_index?: number
    total_steps?: number
    metadata?: Record<string, unknown>
  } = {},
): Promise<void> {
  await api().post(`/v1/worker/sessions/${sessionId}/heartbeat`, body, {
    params: workerParams(),
  })
}

export async function postProgress(
  sessionId: number,
  body: {
    message: string
    step?: string
    step_index?: number
    total_steps?: number
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await api().post(`/v1/worker/sessions/${sessionId}/progress`, body, {
    params: workerParams(),
  })
}

export async function postResult(sessionId: number, body: SessionPostBody): Promise<void> {
  await api().post(`/v1/worker/sessions/${sessionId}/result`, body, {
    params: workerParams(),
  })
}

export async function fetchCredentials(targetProfileId: number): Promise<{ password: string; version: number }> {
  const { data } = await api().get(`/v1/worker/credentials/${targetProfileId}`, {
    params: workerParams(),
  })
  return data.data
}

export async function uploadEvidence(sessionId: number, filePath: string, kind: string): Promise<string | null> {
  const bytes = await readFile(filePath)
  const fd = new FormData()
  fd.append('file', new Blob([bytes]), basename(filePath))
  fd.append('kind', kind)

  const { data } = await api().post(`/v1/worker/sessions/${sessionId}/evidence`, fd, {
    params: workerParams(),
    headers: { 'X-Worker-Token': config.workerToken },
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  })

  const payload = data?.data ?? data
  return typeof payload?.path === 'string' ? payload.path : null
}

/** Persist one file I/O scenario verdict (hash/MIME/structure + data verification). */
export async function postFileIoResult(sessionId: number, body: FileIoTestPayload): Promise<number | null> {
  const { data } = await api().post(`/v1/worker/sessions/${sessionId}/file-io`, body, {
    params: workerParams(),
  })
  const id = (data?.data ?? data)?.id
  return typeof id === 'number' ? id : null
}

/**
 * Copy an artifact (fixture or downloaded export) to the API host so the portal
 * can serve it even when the worker runs on a different machine.
 */
export async function uploadFileIoArtifact(testId: number, key: string, filePath: string): Promise<void> {
  const bytes = await readFile(filePath)
  const fd = new FormData()
  fd.append('file', new Blob([bytes]), basename(filePath))
  fd.append('key', key)

  await api().post(`/v1/worker/file-io/${testId}/artifact`, fd, {
    params: workerParams(),
    headers: { 'X-Worker-Token': config.workerToken },
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  })
}

export async function getDecisionMemory(params: {
  product_name: string
  environment: string
  situation_key: string
}): Promise<{ selected_option?: string } | null> {
  const { data } = await api().get(`/v1/worker/decision-memory`, { params })
  const payload = data?.data ?? data
  return payload?.memory ?? payload ?? null
}

export async function createDecision(body: {
  session_id: number
  qa_run_id: string
  situation_key: string
  question: string
  options_json: DecisionOption[]
  context_json?: Record<string, unknown>
  screenshot_path?: string
  memory_applied?: boolean
  selected_option?: string
}): Promise<DecisionRow> {
  const { data } = await api().post(`/v1/worker/decisions`, body, { params: workerParams() })
  const payload = data?.data ?? data
  return (payload?.decision ?? payload) as DecisionRow
}

export async function getDecision(id: number): Promise<DecisionRow> {
  const { data } = await api().get(`/v1/worker/decisions/${id}`, { params: workerParams() })
  const payload = data?.data ?? data
  return (payload?.decision ?? payload) as DecisionRow
}

export async function timeoutDecision(id: number): Promise<void> {
  await api().post(`/v1/worker/decisions/${id}/timeout`, {}, { params: workerParams() })
}
