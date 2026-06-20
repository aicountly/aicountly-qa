import type { Page } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface ScreenshotResult {
  path: string
  label: string
  timestamp: string
}

export class ScreenshotCapture {
  private shots: ScreenshotResult[] = []
  private counter = 0

  constructor(private readonly dir: string) {}

  async take(page: Page, label: string): Promise<ScreenshotResult> {
    this.counter += 1
    const safe = label.replace(/[^a-z0-9_\-]+/gi, '-').toLowerCase()
    const path = join(this.dir, `screenshots`, `${String(this.counter).padStart(3, '0')}-${safe}.png`)
    await mkdir(dirname(path), { recursive: true })
    const buf = await page.screenshot({ fullPage: true })
    await writeFile(path, buf)
    const entry: ScreenshotResult = { path, label, timestamp: new Date().toISOString() }
    this.shots.push(entry)
    return entry
  }

  paths(): string[] { return this.shots.map((s) => s.path) }
  entries(): ScreenshotResult[] { return [...this.shots] }
}
