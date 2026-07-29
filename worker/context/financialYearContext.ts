import type { Page } from 'playwright'

export async function selectOrCreateFinancialYear(
  page: Page,
  fy: { name: string; start: string; end: string },
): Promise<{ status: 'selected' | 'created' | 'skipped' }> {
  const picker = page.locator('[data-test=fy-picker], select[name=financial_year], select[name=fy]').first()
  if (await picker.count()) {
    if ((await picker.evaluate((el) => el.tagName)).toLowerCase() === 'select') {
      await picker.selectOption({ label: fy.name }).catch(() => null)
    } else {
      await picker.click()
      await page.locator(`text="${fy.name}"`).first().click({ timeout: 5_000 }).catch(() => null)
    }
    return { status: 'selected' }
  }

  const newBtn = page.locator('button:has-text("New FY"), button:has-text("Create Financial Year"), [data-test=new-fy]').first()
  if (await newBtn.count()) {
    await newBtn.click()
    await page.locator('input[name=name], [data-test=fy-name]').first().fill(fy.name).catch(() => null)
    await page.locator('input[name=start]').first().fill(fy.start).catch(() => null)
    await page.locator('input[name=end]').first().fill(fy.end).catch(() => null)
    await page.locator('button[type=submit], button:has-text("Save")').first().click().catch(() => null)
    return { status: 'created' }
  }

  return { status: 'skipped' }
}
