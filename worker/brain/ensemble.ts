/**
 * Worker-side facade that delegates all AI calls back to the QA API. The
 * worker never sees provider API keys directly — they live in server-php/.env.
 */

import axios from 'axios'
import { config } from '../utils/config.js'

let client: ReturnType<typeof axios.create> | null = null

function api() {
  if (client) return client
  client = axios.create({
    baseURL: config.apiUrl.replace(/\/$/, ''),
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Token': config.workerToken,
      'X-Worker-Id': config.workerId,
      'User-Agent': `${config.packageName}/0.2 (+dedicated-qa-worker)`,
    },
  })
  return client
}

export type BrainImage = {
  data: string
  mime_type?: string
}

export class BrainUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly detail: string,
  ) {
    super(`Brain provider ${provider || 'unknown'} unavailable: ${detail}`)
    this.name = 'BrainUnavailableError'
  }
}

export async function invokeBrain(
  task: string,
  systemPrompt: string,
  userPrompt: string,
  context: Record<string, unknown> = {},
  images: BrainImage[] = [],
): Promise<{ task: string; final: unknown; arbiter: string; parallel: unknown }> {
  try {
    const r = await api().post<{ data: { task: string; final: unknown; arbiter: string; parallel: unknown } }>(
      '/v1/worker/brain/invoke',
      { task, system_prompt: systemPrompt, user_prompt: userPrompt, context, images },
      // Vision: 30s. Text (synthetic_data etc.): 50s — backend caps provider wait at 45s.
      { params: { worker_id: config.workerId }, timeout: images.length ? 30_000 : 50_000 },
    )
    return r.data.data
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const body = error.response?.data as { error?: string; provider?: string; detail?: string } | undefined
      if (error.response?.status === 503 || body?.error === 'brain_unavailable') {
        throw new BrainUnavailableError(
          String(body?.provider ?? 'unknown'),
          String(body?.detail ?? error.message),
        )
      }
    }
    throw error
  }
}

export async function brainHealth(): Promise<{
  vision_available: boolean
  vision_providers: string[]
}> {
  const response = await api().get<{ data: {
    vision_available: boolean
    vision_providers: string[]
  } }>('/v1/worker/brain/health', { params: { worker_id: config.workerId }, timeout: 10_000 })
  return response.data.data
}
