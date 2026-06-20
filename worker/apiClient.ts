/**
 * QA Portal API client used by the Playwright worker.
 * Authenticates with a long-lived shared secret: X-Worker-Token.
 */

import axios, { type AxiosInstance } from 'axios'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { NextSessionPayload, SessionPostBody } from './types.js'
import { config } from './utils/config.js'

let client: AxiosInstance | null = null

function api(): AxiosInstance {
  if (client) return client
  client = axios.create({
    baseURL: config.apiUrl.replace(/\/$/, ''),
    timeout: 30_000,
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Token': config.workerToken,
    },
  })
  return client
}

export async function fetchNextSession(): Promise<NextSessionPayload> {
  const { data } = await api().get(`/v1/worker/next-session`, {
    params: { worker_id: config.workerId },
  })
  return (data?.data ?? data) as NextSessionPayload
}

export async function heartbeat(sessionId: number): Promise<void> {
  await api().post(`/v1/worker/sessions/${sessionId}/heartbeat`)
}

export async function postResult(sessionId: number, body: SessionPostBody): Promise<void> {
  await api().post(`/v1/worker/sessions/${sessionId}/result`, body)
}

export async function fetchCredentials(targetProfileId: number): Promise<{ password: string; version: number }> {
  const { data } = await api().get(`/v1/worker/credentials/${targetProfileId}`)
  return data.data
}

export async function uploadEvidence(sessionId: number, filePath: string, kind: string): Promise<void> {
  const bytes = await readFile(filePath)
  const fd = new FormData()
  fd.append('file', new Blob([bytes]), basename(filePath))
  fd.append('kind', kind)

  await api().post(`/v1/worker/sessions/${sessionId}/evidence`, fd, {
    headers: { 'X-Worker-Token': config.workerToken },
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  })
}
