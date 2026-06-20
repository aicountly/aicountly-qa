import type { Page, Request, Response } from 'playwright'

export interface NetworkEntry {
  url: string
  method: string
  status?: number
  error?: string
  timestamp: string
}

export class NetworkCapture {
  private entries: NetworkEntry[] = []

  attach(page: Page): void {
    page.on('response', async (resp: Response) => {
      const req = resp.request()
      if (resp.status() >= 400) {
        this.entries.push({
          url: req.url(),
          method: req.method(),
          status: resp.status(),
          timestamp: new Date().toISOString(),
        })
      }
    })
    page.on('requestfailed', (req: Request) => {
      this.entries.push({
        url: req.url(),
        method: req.method(),
        error: req.failure()?.errorText || 'unknown',
        timestamp: new Date().toISOString(),
      })
    })
  }

  errors(): NetworkEntry[] {
    return [...this.entries]
  }
}
