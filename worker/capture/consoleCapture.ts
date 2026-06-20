import type { Page } from 'playwright'

export interface ConsoleEntry {
  type: string
  text: string
  location?: string
  timestamp: string
}

export class ConsoleCapture {
  private entries: ConsoleEntry[] = []

  attach(page: Page): void {
    page.on('console', (msg) => {
      this.entries.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url || '',
        timestamp: new Date().toISOString(),
      })
    })
    page.on('pageerror', (err) => {
      this.entries.push({
        type: 'pageerror',
        text: err.message,
        timestamp: new Date().toISOString(),
      })
    })
  }

  errors(): ConsoleEntry[] {
    return this.entries.filter((e) => e.type === 'error' || e.type === 'pageerror')
  }

  all(): ConsoleEntry[] {
    return [...this.entries]
  }
}
