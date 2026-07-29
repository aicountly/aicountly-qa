import type { Page } from 'playwright'

/**
 * Selects or creates a company within an AICOUNTLY app after login. Tries common
 * patterns (dropdown picker, list table, "create new" CTA) and falls back to a
 * no-op when the app has no explicit company-context UI.
 */
export async function selectOrCreateCompany(page: Page, name: string): Promise<{ status: 'selected' | 'created' | 'skipped'; details?: string }> {
  const pickerSelectors = [
    '[data-test=company-picker]',
    'select[name=company]',
    'input[role=combobox][aria-label*="company" i]',
  ]
  for (const sel of pickerSelectors) {
    const l = page.locator(sel).first()
    if (await l.count()) {
      if ((await l.evaluate((el) => el.tagName)).toLowerCase() === 'select') {
        await l.selectOption({ label: name }).catch(() => null)
      } else {
        await l.click()
        await page.locator(`text="${name}"`).first().click({ timeout: 5_000 }).catch(() => null)
      }
      return { status: 'selected' }
    }
  }

  // Look for existing row.
  const row = page.locator(`tr:has-text("${name}")`).first()
  if (await row.count()) {
    await row.click()
    return { status: 'selected' }
  }

  // Try to create.
  const newBtn = page.locator('button:has-text("New Company"), button:has-text("Create Company"), [data-test=new-company]').first()
  if (await newBtn.count()) {
    await newBtn.click()
    await page.locator('input[name=name], [data-test=company-name]').first().fill(name).catch(() => null)
    await page.locator('button[type=submit], button:has-text("Save")').first().click().catch(() => null)
    return { status: 'created' }
  }

  return { status: 'skipped', details: 'No company picker found.' }
}
