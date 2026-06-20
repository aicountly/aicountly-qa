import type { BrowserContext } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Wraps Playwright's built-in tracing so the session runner writes a single
 * trace.zip alongside screenshots.
 */
export class TraceCapture {
  private path: string

  constructor(private readonly dir: string) {
    this.path = join(this.dir, 'trace.zip')
  }

  async start(context: BrowserContext): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    })
  }

  async stop(context: BrowserContext): Promise<string | null> {
    try {
      await context.tracing.stop({ path: this.path })
      return this.path
    } catch {
      return null
    }
  }
}
