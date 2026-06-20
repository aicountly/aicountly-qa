import type { Page } from 'playwright'
import { fetchCredentials } from '../apiClient.js'
import type { TargetProfile } from '../types.js'

/**
 * Logs into a target AICOUNTLY app. Tries common selector patterns first;
 * a per-product override can be supplied via the template's "login_overrides" field.
 */
export async function loginToTarget(page: Page, profile: TargetProfile): Promise<void> {
  const creds = await fetchCredentials(profile.id)

  await page.goto(profile.login_url, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  const emailSelectors = [
    '[data-test=email]',
    'input[name=email]',
    'input[name=username]',
    'input[type=email]',
    '#email', '#username',
  ]
  const passwordSelectors = [
    '[data-test=password]',
    'input[name=password]',
    'input[type=password]',
    '#password',
  ]
  const submitSelectors = [
    '[data-test=login-submit]',
    'button[type=submit]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
  ]

  await fillOneOf(page, emailSelectors, profile.username)
  await fillOneOf(page, passwordSelectors, creds.password)
  await clickOneOf(page, submitSelectors)

  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})

  if (await page.locator('text=/invalid|incorrect|wrong/i').count()) {
    throw new Error('Target app reported invalid credentials.')
  }
}

async function fillOneOf(page: Page, selectors: string[], value: string): Promise<void> {
  for (const sel of selectors) {
    const l = page.locator(sel).first()
    if (await l.count()) {
      await l.fill(value)
      return
    }
  }
  throw new Error(`No matching input for ${selectors.join(', ')}.`)
}

async function clickOneOf(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const l = page.locator(sel).first()
    if (await l.count()) {
      await l.click()
      return
    }
  }
  throw new Error(`No matching button for ${selectors.join(', ')}.`)
}
